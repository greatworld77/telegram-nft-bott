// api/webhook.js - UNIFIED BOT (Novita AI + NFT Minting)
// Version: 2.0.0 - Merged

const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { ethers } = require('ethers');

// ==================== CONFIGURATION ====================

// Cloudinary setup
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Novita AI setup
const NOVITA_API_KEY = process.env.NOVITA_API_KEY;

// Contract ABI
const CONTRACT_ABI = [
    "function mintNFT(address to, uint8 pixelLevel) external payable",
    "function getMintPrice() external view returns (uint256)",
    "function totalSupply() external view returns (uint256)"
];

// Network configuration
const NETWORKS = {
    sepolia: {
        name: 'Sepolia Testnet',
        rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
        explorerUrl: 'https://sepolia.etherscan.io',
        currencySymbol: 'tETH',
        chainId: 11155111,
        isTestnet: true
    },
    mainnet: {
        name: 'Ethereum Mainnet',
        rpcUrl: process.env.MAINNET_RPC_URL || 'https://rpc.ankr.com/eth',
        explorerUrl: 'https://etherscan.io',
        currencySymbol: 'ETH',
        chainId: 1,
        isTestnet: false
    }
};

const CURRENT_NETWORK = NETWORKS[process.env.BLOCKCHAIN_NETWORK || 'sepolia'];
const YOUR_WALLET = process.env.YOUR_WALLET_ADDRESS;
const CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const NFT_PRICE = process.env.NFT_PRICE || "0.001";

// Database connection
let db;
let client;
let provider;
let contractWithSigner;

// User sessions (in-memory)
const userSessions = {};

// ==================== HELPER FUNCTIONS ====================

async function connectDB() {
    if (!client) {
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('unified_bot');
    }
    return db;
}

function getProvider() {
    if (!provider) {
        provider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
    }
    return provider;
}

async function getContractWithSigner() {
    if (!contractWithSigner) {
        const provider = getProvider();
        const privateKey = process.env.BOT_WALLET_PRIVATE_KEY;
        const wallet = new ethers.Wallet(privateKey, provider);
        contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    }
    return contractWithSigner;
}

async function sendMessage(chatId, text, parseMode = 'Markdown') {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: parseMode
            })
        });
    } catch (error) {
        console.error('Send message error:', error);
    }
}

async function sendPhoto(chatId, photoUrl, caption = '') {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                photo: photoUrl,
                caption: caption
            })
        });
    } catch (error) {
        console.error('Send photo error:', error);
    }
}

// ==================== NOVITA AI FUNCTIONS (FROM BOT #1) ====================

async function generateImageWithNovita(prompt) {
    if (!NOVITA_API_KEY) {
        console.error('NOVITA_API_KEY is not set');
        return null;
    }
    
    const apiUrl = 'https://api.novita.ai/v3/async/txt2img';
    
    const requestBody = {
        "extra": {
            "response_image_type": "jpeg"
        },
        "request": {
            "model_name": "sd_xl_base_1.0.safetensors",
            "prompt": prompt,
            "negative_prompt": "nsfw, ugly, bad face, blurry",
            "width": 1024,
            "height": 1024,
            "image_num": 1,
            "steps": 20,
            "seed": -1,
            "guidance_scale": 7.5
        }
    };
    
    try {
        const createResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOVITA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const createData = await createResponse.json();
        
        if (!createResponse.ok) {
            console.error('Novita API Error:', createData);
            return null;
        }
        
        const taskId = createData.task_id;
        if (!taskId) return null;
        
        // Poll for results
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const resultResponse = await fetch(
                `https://api.novita.ai/v3/async/task-result?task_id=${taskId}`,
                { headers: { 'Authorization': `Bearer ${NOVITA_API_KEY}` } }
            );
            
            const resultData = await resultResponse.json();
            
            if (resultData.task?.status === 'TASK_STATUS_SUCCEED') {
                if (resultData.images && resultData.images.length > 0) {
                    return resultData.images[0].image_url;
                }
            }
            
            if (resultData.task?.status === 'TASK_STATUS_FAILED') {
                return null;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Novita AI Error:', error);
        return null;
    }
}

// ==================== NFT MINTING FUNCTIONS (FROM BOT #2) ====================

async function verifyPaymentOnBlockchain(txHash, expectedAmount, recipientWallet) {
    const provider = getProvider();
    
    try {
        const tx = await provider.getTransaction(txHash);
        if (!tx) return { success: false, error: 'Transaction not found' };
        
        if (tx.to?.toLowerCase() !== recipientWallet.toLowerCase()) {
            return { success: false, error: 'Wrong recipient' };
        }
        
        const sentAmount = parseFloat(ethers.formatEther(tx.value));
        if (sentAmount < parseFloat(expectedAmount)) {
            return { success: false, error: `Sent ${sentAmount} but expected ${expectedAmount}` };
        }
        
        const receipt = await tx.wait(1);
        if (receipt.status === 1) {
            return { success: true, from: tx.from, amount: sentAmount };
        }
        
        return { success: false, error: 'Transaction failed' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function mintNFTToUser(userWalletAddress, imageUrl, pixelLevel = 8) {
    try {
        const contract = await getContractWithSigner();
        const price = await contract.getMintPrice();
        
        const tx = await contract.mintNFT(userWalletAddress, pixelLevel, { value: price });
        const receipt = await tx.wait();
        
        // Extract token ID
        const mintEvent = receipt.logs.find(log => {
            try {
                return log.topics[0] === ethers.id("NFTMinted(address,uint256,uint8,uint256)");
            } catch {
                return false;
            }
        });
        
        const tokenId = mintEvent ? parseInt(mintEvent.topics[2]).toString() : 'unknown';
        
        return {
            success: true,
            transactionHash: receipt.hash,
            tokenId: tokenId,
            explorerUrl: `${CURRENT_NETWORK.explorerUrl}/tx/${receipt.hash}`
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function uploadToCloudinary(imageUrl, userId) {
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.buffer();
    
    const uploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            { folder: `nft_uploads/${userId}` },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        ).end(imageBuffer);
    });
    
    return uploadResult.secure_url;
}

async function pixelateImage(imageUrl, pixelSize = 10) {
    return imageUrl.replace('/upload/', `/upload/e_pixelate:${pixelSize}/`);
}

// ==================== MAIN UNIFIED WEBHOOK ====================

async function handleWebhook(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('OK');
    }

    const update = req.body;
    if (!update.message) {
        res.status(200).send('OK');
        return;
    }

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text;
    const photo = update.message.photo;
    
    if (!userSessions[userId]) {
        userSessions[userId] = { step: 'start' };
    }
    
    // ==================== COMMANDS ====================
    
    // /start command - Show both options
    if (text === '/start') {
        userSessions[userId] = { step: 'main_menu' };
        await sendMessage(chatId,
            `🎨 **Welcome to Unified NFT Bot!**\n\n` +
            `Choose how you want to create your NFT:\n\n` +
            `🤖 **Option 1: Generate with AI**\n` +
            `Send: \`/generate a beautiful sunset\`\n` +
            `(I'll use Novita AI to create art from your description)\n\n` +
            `📸 **Option 2: Upload your image**\n` +
            `Just send me any photo directly\n\n` +
            `💰 **Price:** ${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}\n` +
            `🌐 **Network:** ${CURRENT_NETWORK.name}\n\n` +
            `Type /help to see all commands`
        );
        return;
    }
    
    // /help command
    if (text === '/help') {
        await sendMessage(chatId,
            `📖 **Commands**\n\n` +
            `**AI Generation:**\n` +
            `/generate [description] - Create image with AI\n` +
            `/generateandmint [description] - Generate AND mint as NFT\n\n` +
            `**NFT Minting:**\n` +
            `/mint - Start NFT minting process\n` +
            `/status - Check your order status\n` +
            `/price - Show current price\n\n` +
            `**Info:**\n` +
            `/network - Show blockchain network\n` +
            `/start - Main menu`
        );
        return;
    }
    
    // /price command
    if (text === '/price') {
        await sendMessage(chatId,
            `💰 **Current Price:** ${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}\n` +
            `🌐 **Network:** ${CURRENT_NETWORK.name}`
        );
        return;
    }
    
    // /network command
    if (text === '/network') {
        await sendMessage(chatId,
            `🌐 **Network:** ${CURRENT_NETWORK.name}\n` +
            `🔗 **Explorer:** ${CURRENT_NETWORK.explorerUrl}\n` +
            `💰 **Currency:** ${CURRENT_NETWORK.currencySymbol}\n` +
            `${CURRENT_NETWORK.isTestnet ? '🧪 Testnet mode' : '🔴 Mainnet mode'}`
        );
        return;
    }
    
    // /status command
    if (text === '/status') {
        const dbConnection = await connectDB();
        const orders = dbConnection.collection('orders');
        const userOrder = await orders.findOne({ userId: userId });
        
        if (!userOrder) {
            await sendMessage(chatId, "📭 No active orders. Send /start to create one!");
        } else {
            await sendMessage(chatId,
                `📊 **Your NFT Status**\n\n` +
                `• Status: ${userOrder.status}\n` +
                `• Order ID: \`${userOrder.orderId}\`\n` +
                (userOrder.paymentHash ? `• Transaction: \`${userOrder.paymentHash.substring(0, 20)}...\`\n` : '') +
                (userOrder.tokenId ? `• Token ID: ${userOrder.tokenId}` : '')
            );
        }
        return;
    }
    
    // ==================== AI GENERATION (NOVITA) ====================
    
    // /generate command - Just generate, no mint
    if (text && text.startsWith('/generate') && !text.includes('andmint')) {
        let prompt = text.replace('/generate', '').trim();
        
        if (!prompt) {
            await sendMessage(chatId, "📝 Please provide a description!\n\nExample: `/generate a cyberpunk cat with neon lights`");
            return;
        }
        
        await sendMessage(chatId, "🎨 Generating your image with Novita AI... This may take 10-15 seconds.");
        
        const imageUrl = await generateImageWithNovita(prompt);
        
        if (imageUrl) {
            await sendPhoto(chatId, imageUrl, 
                `🖼️ **Generated for:** "${prompt}"\n\n` +
                `To mint this as an NFT, reply with:\n` +
                `/mintthis`
            );
            
            // Store the generated image in session
            userSessions[userId].generatedImage = imageUrl;
            userSessions[userId].prompt = prompt;
        } else {
            await sendMessage(chatId, "❌ Failed to generate image. Please try again with a different prompt.");
        }
        return;
    }
    
    // /generateandmint command - Generate AND mint as NFT
    if (text && text.startsWith('/generateandmint')) {
        let prompt = text.replace('/generateandmint', '').trim();
        
        if (!prompt) {
            await sendMessage(chatId, "📝 Please provide a description!\n\nExample: `/generateandmint a pixel art dragon`");
            return;
        }
        
        await sendMessage(chatId, "🎨 Generating your image with Novita AI...");
        
        const imageUrl = await generateImageWithNovita(prompt);
        
        if (!imageUrl) {
            await sendMessage(chatId, "❌ Failed to generate image. Please try again.");
            return;
        }
        
        await sendMessage(chatId, "✨ Image generated! Now pixelating for NFT...");
        
        // Pixelate the image
        const pixelatedUrl = await pixelateImage(imageUrl);
        
        // Save to database
        const dbConnection = await connectDB();
        const orders = dbConnection.collection('orders');
        const orderId = 'ORD_' + userId + '_' + Date.now();
        
        await orders.insertOne({
            orderId: orderId,
            userId: userId,
            chatId: chatId,
            prompt: prompt,
            originalImageUrl: imageUrl,
            pixelatedImageUrl: pixelatedUrl,
            status: 'awaiting_payment',
            createdAt: new Date(),
            amount: NFT_PRICE,
            source: 'novita_ai'
        });
        
        userSessions[userId] = {
            step: 'awaiting_payment',
            orderId: orderId,
            pixelatedUrl: pixelatedUrl
        };
        
        await sendPhoto(chatId, pixelatedUrl, "🖼️ **Your pixelated NFT preview!**");
        
        await sendMessage(chatId,
            `✅ **Ready for minting!**\n\n` +
            `💳 Send **${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}** to:\n` +
            `\`${YOUR_WALLET}\`\n\n` +
            `📝 Then reply with your transaction hash (TxID)`
        );
        return;
    }
    
    // /mintthis command - Mint the last generated image
    if (text === '/mintthis') {
        if (!userSessions[userId].generatedImage) {
            await sendMessage(chatId, "❌ No generated image found. First use `/generate` to create an image.");
            return;
        }
        
        const imageUrl = userSessions[userId].generatedImage;
        const pixelatedUrl = await pixelateImage(imageUrl);
        
        const dbConnection = await connectDB();
        const orders = dbConnection.collection('orders');
        const orderId = 'ORD_' + userId + '_' + Date.now();
        
        await orders.insertOne({
            orderId: orderId,
            userId: userId,
            chatId: chatId,
            originalImageUrl: imageUrl,
            pixelatedImageUrl: pixelatedUrl,
            status: 'awaiting_payment',
            createdAt: new Date(),
            amount: NFT_PRICE,
            source: 'novita_ai'
        });
        
        userSessions[userId] = {
            step: 'awaiting_payment',
            orderId: orderId,
            pixelatedUrl: pixelatedUrl
        };
        
        await sendPhoto(chatId, pixelatedUrl, "🖼️ **Your pixelated NFT preview!**");
        
        await sendMessage(chatId,
            `💳 Send **${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}** to:\n` +
            `\`${YOUR_WALLET}\`\n\n` +
            `📝 Then reply with your transaction hash`
        );
        return;
    }
    
    // ==================== IMAGE UPLOAD (FROM BOT #2) ====================
    
    if (photo && (!userSessions[userId].step || userSessions[userId].step === 'start' || userSessions[userId].step === 'main_menu')) {
        const largestPhoto = photo[photo.length - 1];
        const fileId = largestPhoto.file_id;
        
        await sendMessage(chatId, "📸 **Image received!** Processing...");
        
        try {
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            const filePath = fileData.result.file_path;
            const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${filePath}`;
            
            const cloudinaryUrl = await uploadToCloudinary(imageUrl, userId);
            const pixelatedUrl = await pixelateImage(cloudinaryUrl);
            
            const dbConnection = await connectDB();
            const orders = dbConnection.collection('orders');
            const orderId = 'ORD_' + userId + '_' + Date.now();
            
            await orders.insertOne({
                orderId: orderId,
                userId: userId,
                chatId: chatId,
                originalImageUrl: cloudinaryUrl,
                pixelatedImageUrl: pixelatedUrl,
                status: 'awaiting_payment',
                createdAt: new Date(),
                amount: NFT_PRICE,
                source: 'user_upload'
            });
            
            userSessions[userId] = {
                step: 'awaiting_payment',
                orderId: orderId,
                pixelatedUrl: pixelatedUrl
            };
            
            await sendPhoto(chatId, pixelatedUrl, "🖼️ **Your pixelated NFT preview!**");
            
            await sendMessage(chatId,
                `✅ **Image processed!**\n\n` +
                `💳 Send **${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}** to:\n` +
                `\`${YOUR_WALLET}\`\n\n` +
                `📝 Reply with your transaction hash`
            );
            
        } catch (error) {
            await sendMessage(chatId, "❌ Failed to process image. Please try again.");
        }
        return;
    }
    
    // ==================== PAYMENT VERIFICATION (FROM BOT #2) ====================
    
    if (userSessions[userId].step === 'awaiting_payment' && text && text.startsWith('0x') && text.length >= 60) {
        const transactionHash = text.trim();
        
        await sendMessage(chatId, "🔍 Verifying payment...");
        
        const verification = await verifyPaymentOnBlockchain(transactionHash, NFT_PRICE, YOUR_WALLET);
        
        if (verification.success) {
            const dbConnection = await connectDB();
            const orders = dbConnection.collection('orders');
            
            await orders.updateOne(
                { orderId: userSessions[userId].orderId },
                { 
                    $set: { 
                        paymentHash: transactionHash,
                        payerWallet: verification.from,
                        status: 'payment_verified',
                        verifiedAt: new Date()
                    }
                }
            );
            
            await sendMessage(chatId, "✅ **Payment verified!** Minting your NFT...");
            
            const mintResult = await mintNFTToUser(verification.from, userSessions[userId].pixelatedUrl);
            
            if (mintResult.success) {
                await orders.updateOne(
                    { orderId: userSessions[userId].orderId },
                    { 
                        $set: { 
                            status: 'completed',
                            tokenId: mintResult.tokenId,
                            mintTransactionHash: mintResult.transactionHash
                        }
                    }
                );
                
                await sendMessage(chatId,
                    `🎉 **NFT Minted Successfully!** 🎉\n\n` +
                    `✨ Token ID: \`${mintResult.tokenId}\`\n` +
                    `🔗 [View on Explorer](${mintResult.explorerUrl})\n\n` +
                    `Thank you for minting! 🚀`
                );
                
                userSessions[userId].step = 'completed';
            } else {
                await sendMessage(chatId, `❌ Minting failed: ${mintResult.error}`);
            }
        } else {
            await sendMessage(chatId, `❌ Payment verification failed: ${verification.error}`);
        }
        return;
    }
    
    // Default response
    if (text && !text.startsWith('/')) {
        await sendMessage(chatId,
            `🤔 Unknown command.\n\n` +
            `• Generate AI art: /generate [description]\n` +
            `• Generate and mint: /generateandmint [description]\n` +
            `• Upload your image: Just send a photo\n` +
            `• Help: /help`
        );
    }
    
    res.status(200).send('OK');
}

module.exports = async (req, res) => {
    try {
        await handleWebhook(req, res);
    } catch (error) {
        console.error('Fatal error:', error);
        res.status(200).send('OK');
    }
};
