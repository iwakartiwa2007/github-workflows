const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const IMAGE_DRIVE_ID = process.env.IMAGE_DRIVE_ID;
const TIKTOK_URL = process.env.TIKTOK_URL;
const OSID = process.env.COOKIE_OSID;
const SECURE_OSID = process.env.COOKIE_SECURE_OSID;
const HARDCODED_PROMPT = "*Create DT-VGM,DT+V2V+MOTION CONTROL+DANCING TRANSFER The woman original image Reference dancing synchronyze choreography video original Reference 100% Background based on the reference image.";

// Fungsi Unduh Foto dari Google Drive
async function downloadDriveImage(fileId) {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const filePath = path.join(__dirname, 'model_image.jpg');
    const response = await axios({ method: 'GET', url: url, responseType: 'stream' });
    await pipeline(response.data, fs.createWriteStream(filePath));
    return filePath;
}

// Fungsi Unduh TikTok via TikWM
async function downloadTikTokVideo(tiktokUrl) {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`;
    const response = await axios.get(apiUrl);
    const videoUrl = response.data.data.play;
    const filePath = path.join(__dirname, 'tiktok_ref.mp4');
    const videoResponse = await axios({ method: 'GET', url: videoUrl, responseType: 'stream' });
    await pipeline(videoResponse.data, fs.createWriteStream(filePath));
    return filePath;
}

(async () => {
    try {
        console.log("1. Mengunduh bahan referensi...");
        const imagePath = await downloadDriveImage(IMAGE_DRIVE_ID);
        const videoPath = await downloadTikTokVideo(TIKTOK_URL);

        console.log("2. Membuka Puppeteer Serverless...");
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720']
        });
        const page = await browser.newPage();
        
        // Pasang Cookie Login
        await page.setCookie(
            { name: 'OSID', value: OSID, domain: '.google.com' },
            { name: '__Secure-OSID', value: SECURE_OSID, domain: '.google.com' }
        );

        console.log("3. Membuka Google Flow...");
        await page.goto('https://flow.google.com/project/e7d9da23-8e20-45df-97e6-a66a6ae8ef93', { waitUntil: 'networkidle2' });

        // Proses Upload
        const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.click('.add-menu-trigger')
        ]);
        await fileChooser.accept([imagePath, videoPath]);
        await page.waitForTimeout(4000); // Jeda agar file terproses di UI

        console.log("4. Memasukkan Prompt & Eksekusi...");
        await page.type('.editable-text-input', HARDCODED_PROMPT);
        await page.click('.settings-trigger-button.flow-button-primary');

        console.log("5. Menunggu render video (Maksimal 5 Menit)...");
        const videoUrl = await page.waitForFunction(() => {
            const videos = document.querySelectorAll('video');
            const lastVideo = videos[videos.length - 1];
            if (lastVideo && lastVideo.src && lastVideo.src !== "") return lastVideo.src;
            return false;
        }, { timeout: 300000 });

        console.log("6. Mengunduh hasil dari web...");
        // Mengeksekusi download dari dalam konteks browser (untuk handle Blob URL)
        const base64Data = await page.evaluate(async (url) => {
            const res = await fetch(url);
            const blob = await res.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }, videoUrl);

        // Simpan file ke folder /output
        const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
        if (!fs.existsSync('./output')) fs.mkdirSync('./output');
        fs.writeFileSync('./output/hasil_dance.mp4', buffer);
        console.log("Video sukses disimpan! Siap ditangkap oleh Artifacts.");

        await browser.close();
    } catch (error) {
        console.error("Terjadi Kesalahan:", error);
        process.exit(1); // Beri tahu GitHub Actions bahwa job gagal
    }
})();
