const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserDataDirPlugin = require('@zorilla/puppeteer-extra-plugin-user-data-dir');
const { createCursor } = require('ghost-cursor');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Kích hoạt các plugin tàng hình và quản lý session
puppeteer.use(StealthPlugin());
puppeteer.use(UserDataDirPlugin({ deleteExisting: false }));

// ================= CẤU HÌNH =================
const BOT_TOKEN = 'ĐIỀN_TOKEN_BOT_CỦA_BẠN_VÀO_ĐÂY';
// ============================================

const ORION_CODE = fs.readFileSync('index.js', 'utf8');
const activeUsers = new Set();
const PROFILES_DIR = path.join(__dirname, 'profiles');

if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages] 
});

const sleep = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

// ==================================================================
// HÀM TẠO PROFILE VÂN TAY (Chống trùng lặp)
// ==================================================================
function getFingerprintProfile(userId) {
    const profilePath = path.join(PROFILES_DIR, `${userId}_fingerprint.json`);
    if (fs.existsSync(profilePath)) return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    
    const gpus = [
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' }
    ];
    const chosenGpu = gpus[Math.floor(Math.random() * gpus.length)];
    const profile = {
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${120 + Math.floor(Math.random() * 10)}.0.0.0 Safari/537.36`,
        viewport: { width: 1920, height: 1080 },
        timezone: 'Asia/Ho_Chi_Minh',
        locale: 'vi-VN',
        hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
        deviceMemory: [8, 16, 32][Math.floor(Math.random() * 3)],
        gpu: chosenGpu,
        canvasNoiseSeed: crypto.randomBytes(8).toString('hex'),
        audioNoiseSeed: crypto.randomBytes(8).toString('hex')
    };
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    return profile;
}

// ==================================================================
// TIÊM MÔI TRƯỜNG GIẢ LẬP (TRƯỚC KHI TRANG LOAD)
// ==================================================================
async function applyAdvancedStealth(page, profile) {
    // 1. Fake WebGL
    await page.evaluateOnNewDocument((gpuVendor, gpuRenderer) => {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return gpuVendor;
            if (parameter === 37446) return gpuRenderer;
            return getParameter.call(this, parameter);
        };
    }, profile.gpu.vendor, profile.gpu.renderer);

    // 2. Fake Hardware Concurrency & Device Memory
    await page.evaluateOnNewDocument((cores, memory) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
    }, profile.hardwareConcurrency, profile.deviceMemory);

    // 3. Fake Canvas Fingerprint
    await page.evaluateOnNewDocument((seed) => {
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            const ctx = this.getContext('2d');
            if (ctx) {
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                const data = imageData.data;
                const noise = seed.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
                for (let i = 0; i < data.length; i += 4) data[i] = (data[i] + noise) % 256;
                ctx.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.apply(this, arguments);
        };
    }, profile.canvasNoiseSeed);

    // 4. Fake AudioContext
    await page.evaluateOnNewDocument((seed) => {
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function() {
            const data = originalGetChannelData.apply(this, arguments);
            const noise = seed.charCodeAt(0) / 100000; 
            for (let i = 0; i < data.length; i += 100) data[i] += noise;
            return data;
        };
    }, profile.audioNoiseSeed);

    await page.emulateTimezone(profile.timezone);
    await page.setExtraHTTPHeaders({ 'Accept-Language': profile.locale });
}

// ==================================================================
// HÀNH VI GIỐNG NGƯỜI THẬT
// ==================================================================
async function humanWarmup(page) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 300) + 100));
    await sleep(1000, 2500);
    await page.evaluate(() => window.scrollBy(0, -Math.floor(Math.random() * 200) - 50));
    await sleep(500, 1500);
    const cursor = createCursor(page);
    await cursor.move('body');
    await sleep(300, 800);
}

async function humanClick(page, selector) {
    const cursor = createCursor(page);
    try {
        await cursor.click(selector);
    } catch (e) {
        await page.click(selector);
    }
}

// ==================================================================
// CÁC HÀM XỬ LÝ LỆNH DISCORD
// ==================================================================
client.once('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} đã online! Gõ :quest để bắt đầu.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.content === ':quest') {
        const warningEmbed = new EmbedBuilder()
            .setTitle('⚠️ CẢNH BÁO & ĐIỀU KHOẢN SỬ DỤNG ⚠️')
            .setDescription(
                'Hệ thống sử dụng công nghệ **Human Emulation & Stealth**.\n' +
                '🚫 Vi phạm TOS Discord.\n' +
                '🔨 Nguy cơ khóa Quest 10-15 ngày hoặc ban vĩnh viễn.\n' +
                '🔒 Rủi ro lộ Token nếu chạy trên máy lạ.\n\n' +
                '👉 *Nếu đồng ý, bấm **Tôi Đồng Ý**.*'
            )
            .setColor(0xED4245).setTimestamp();
        const btnGuide = new ButtonBuilder().setCustomId('help_button').setLabel('📖 Hướng Dẫn').setStyle(ButtonStyle.Secondary);
        const btnAgree = new ButtonBuilder().setCustomId('agree_terms').setLabel('✅ Tôi Đồng Ý').setStyle(ButtonStyle.Success);
        await message.reply({ embeds: [warningEmbed], components: [new ActionRowBuilder().addComponents(btnGuide, btnAgree)] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    
    if (interaction.isButton() && interaction.customId === 'help_button') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('📖 Hướng Dẫn Lấy User Token')
            .setDescription('1. Mở Discord trên **Web** (Chrome, Edge...).\n2. Nhấn `F12` -> Tab **Console**.\n3. Dán code sau và Enter:\n```javascript\njavascript:(function () { location.reload(); var i = document.createElement(\'iframe\'); document.body.appendChild(i); prompt(\'Token:\', i.contentWindow.localStorage.token.replace(/\'/g, \'\')); })();\n```\n*(Nếu không chạy, hãy xóa chữ `javascript:` ở đầu đi nhé)*\n4. Copy Token hiện ra và dán vào Bot.')
            .setColor(0xFEE75C);
        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'agree_terms') {
        const menuEmbed = new EmbedBuilder().setTitle('✨ HỆ THỐNG QUEST AUTO ✨').setDescription('Bạn đã đồng ý. Bấm **Bắt Đầu** để chạy.').setColor(0x5865F2);
        const btnStart = new ButtonBuilder().setCustomId('open_token_modal').setLabel('🚀 Bắt Đầu Cày Quest').setStyle(ButtonStyle.Primary);
        await interaction.update({ embeds: [menuEmbed], components: [new ActionRowBuilder().addComponents(btnStart)] });
    }

    if (interaction.isButton() && interaction.customId === 'open_token_modal') {
        if (activeUsers.has(interaction.user.id)) return interaction.reply({ content: '⚠️ Bạn đang có tiến trình chạy rồi!', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('token_modal').setTitle('Nhập User Token Discord');
        const tokenInput = new TextInputBuilder().setCustomId('user_token').setLabel('User Token').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(tokenInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'token_modal') {
        activeUsers.add(interaction.user.id);
        const userToken = interaction.fields.getTextInputValue('user_token');
        await interaction.reply({ content: '✅ Đã nhận Token! Kiểm tra DM để xem Dashboard.', ephemeral: true });
        runQuestAutomation(userToken, interaction.user);
    }
});

// ==================================================================
// HÀM CHẠY CHÍNH VÀ DASHBOARD
// ==================================================================
async function runQuestAutomation(userToken, user) {
    const startTime = Date.now();
    let logMessages = [];
    let isDone = false;
    let dmMessage = null;
    let timerId = null;
    let browser = null;

    try {
        const profile = getFingerprintProfile(user.id);
        const userProfilePath = path.join(PROFILES_DIR, `session_${user.id}`);

        dmMessage = await user.send({ embeds: [new EmbedBuilder().setTitle('⏳ Đang khởi động...').setDescription('Đang mở trình duyệt ẩn và nạp cấu hình...').setColor(0x5865F2)] });

        browser = await puppeteer.launch({
            headless: "new",
            userDataDir: userProfilePath,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080', '--lang=vi-VN'
            ]
        });

        const page = await browser.newPage();
        await applyAdvancedStealth(page, profile);
        await page.setUserAgent(profile.userAgent);
        await page.setViewport(profile.viewport);

        // Bắt log từ file index.js
        page.on('console', async (msg) => {
            const text = msg.text();
            if (text.includes('[ORION]')) {
                const cleanLog = text.replace(/%c\[ORION\] %c/g, '').replace(/%c/g, '').trim();
                const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
                logMessages.push(`[${timeStr}] ${cleanLog}`);
                if (logMessages.length > 5) logMessages.shift(); 
                if (cleanLog.includes('All available quests are completed!') || cleanLog.includes('Nothing left to run.')) isDone = true;
            }
        });

        // Kiểm tra session
        await page.goto('https://discord.com/app', { waitUntil: 'networkidle2' });
        let needLogin = true;
        try {
            await page.waitForSelector('nav[aria-label="Servers sidebar"]', { timeout: 8000 });
            needLogin = false;
        } catch (e) { needLogin = true; }

        if (needLogin) {
            await dmMessage.edit({ embeds: [new EmbedBuilder().setTitle('🔑 Đang đăng nhập...').setColor(0xFEE75C)] });
            await page.goto('https://discord.com/login', { waitUntil: 'networkidle2' });
            await page.evaluate((token) => window.localStorage.setItem('token', `"${token}"`), userToken);
            await sleep(2000, 4000);
            await page.goto('https://discord.com/app', { waitUntil: 'networkidle2' });
            await page.waitForSelector('nav[aria-label="Servers sidebar"]', { timeout: 40000 });
        }

        // Làm quen môi trường
        await dmMessage.edit({ embeds: [new EmbedBuilder().setTitle('🌐 Đang tương tác...').setDescription('Giả lập hành vi lướt web...').setColor(0xFEE75C)] });
        await humanWarmup(page);

        // Inject Orion
        await page.evaluate((code) => {
            eval(code);
            setTimeout(() => { if (window.RUNTIME) window.RUNTIME.randomDelay = true; }, 1000);
        }, ORION_CODE);

        await page.waitForSelector('#start-btn', { timeout: 60000 });
        await humanClick(page, '#start-btn');

        // Vòng lặp cập nhật Dashboard
        const updateDashboard = async () => {
            if (!browser || !browser.connected) return;
            
            const data = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('.task-card'));
                let success = 0, failed = 0, running = 0, pending = 0;
                let details = [];
                cards.forEach(c => {
                    const name = c.querySelector('.task-name')?.innerText || 'Unknown';
                    const progress = c.querySelector('.progress-text')?.innerText || '';
                    if (c.classList.contains('done')) success++;
                    else if (c.classList.contains('failed')) failed++;
                    else if (c.classList.contains('pending')) pending++;
                    else running++;
                    let icon = c.classList.contains('done') ? '✅' : c.classList.contains('failed') ? '❌' : c.classList.contains('pending') ? '⏸️' : '⚡';
                    if (c.classList.contains('running') || c.classList.contains('failed')) details.push({ icon, name, progress });
                });
                const orbText = document.getElementById('orion-orb-total')?.innerText || '';
                return { total: cards.length, success, failed, running, pending, details, orbText };
            });

            const now = Date.now();
            const formattedDuration = formatDuration(Math.floor((now - startTime) / 1000));
            const progressPercent = data.total > 0 ? ((data.success + data.failed) / data.total) : 0;

            const embed = new EmbedBuilder()
                .setTitle(isDone ? '🏆 HOÀN TẤT!' : '⚡ LIVE DASHBOARD')
                .setColor(isDone ? 0x57F287 : 0x5865F2)
                .setDescription(`⏱️ **Đã chạy:** \`${formattedDuration}\`\n📈 **Tiến độ:** ${createProgressBar(progressPercent * 100)} **${Math.round(progressPercent * 100)}%**`)
                .addFields(
                    { name: '📊 Tổng', value: `\`${data.total}\``, inline: true },
                    { name: '✅ Xong', value: `\`${data.success}\``, inline: true },
                    { name: '❌ Lỗi', value: `\`${data.failed}\``, inline: true },
                    { name: '⚡ Chạy', value: `\`${data.running}\``, inline: true },
                    { name: '💎 Phần thưởng', value: data.orbText || 'Đang tính...', inline: true }
                ).setTimestamp(now);

            if (data.details.length > 0) {
                embed.addFields({ name: '🔍 Chi tiết', value: data.details.slice(0, 5).map(q => `${q.icon} **${q.name.substring(0, 20)}...** | \`${q.progress}\``).join('\n') });
            }
            if (logMessages.length > 0) {
                embed.addFields({ name: '📜 Logs', value: `\`\`\`ansi\n${logMessages.join('\n')}\n\`\`\`` });
            }

            await dmMessage.edit({ embeds: [embed] }).catch(() => {});

            if (isDone && data.running === 0) {
                await browser.close();
                activeUsers.delete(user.id);
                return dmMessage.edit({ embeds: [new EmbedBuilder().setTitle('🏁 HOÀN TẤT').setDescription(`Thời gian: ${formattedDuration}`).setColor(0x57F287)] });
            }

            timerId = setTimeout(updateDashboard, Math.floor(Math.random() * 2000) + 3000);
        };

        timerId = setTimeout(updateDashboard, 3000);

    } catch (error) {
        console.error(error);
        if (timerId) clearTimeout(timerId);
        if (browser) await browser.close();
        activeUsers.delete(user.id);
        if (dmMessage) await dmMessage.edit({ embeds: [new EmbedBuilder().setTitle('❌ LỖI').setDescription(`\`\`\`${error.message}\`\`\``).setColor(0xED4245)] }).catch(() => {});
    }
}

// Helpers
function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}
function createProgressBar(percent, length = 12) {
    const filled = Math.round((percent / 100) * length);
    return '🟩'.repeat(filled) + '⬛'.repeat(length - filled);
}

client.login(BOT_TOKEN);
