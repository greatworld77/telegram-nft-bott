// api/webhook.js - Complete NFT Minting Telegram Bot
// Version: 1.0.0 - Sepolia Testnet Ready

const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { ethers } = require('ethers');

// ==================== CONFIGURATION ====================
// Cloudinary setup for image storage
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Contract ABI (only the functions we need)
const CONTRACT_ABI = [
    "function mintNFT(address to, uint8 pixelLevel) external payable",
    "function setMintPrice(uint256 newPrice) external",
    "function withdraw() external",
    "function getMintPrice() external view returns (uint256)",
    "function totalSupply() external view returns (uint256)",
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function pixelationLevel(uint256 tokenId) external view returns (uint8)"
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

// Get current network from environment variable
const CURRENT_NETWORK = NETWORKS[process.env.BLOCKCHAIN_NETWORK || 'sepolia'];
const YOUR_WALLET = process.env.YOUR_WALLET_ADDRESS;
const CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const NFT_PRICE = process.env.NFT_PRICE || "0.001";

// Database connection
let db;
let client;
let provider;
let contractWithSigner;

// ==================== HELPER FUNCTIONS ====================

// Connect to MongoDB
async function connectDB() {
    if (!client) {
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('nft_bot');
        console.log('✅ MongoDB connected');
    }
    return db;
}

// Get blockchain provider
function getProvider() {
    if (!provider) {
        provider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
    }
    return provider;
}

// Get contract with signer (for minting)
async function getContractWithSigner() {
    if (!contractWithSigner) {
        const provider = getProvider();
        const privateKey = process.env.BOT_WALLET_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('BOT_WALLET_PRIVATE_KEY not set');
        }
        const wallet = new ethers.Wallet(privateKey, provider);
        contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
        console.log('✅ Contract connected');
    }
    return contractWithSigner;
}

// Send Telegram message
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

// Send photo message
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

// Verify payment on blockchain
async function verifyPaymentOnBlockchain(txHash, expectedAmount, recipientWallet) {
    const provider = getProvider();
    
    try {
        console.log(`🔍 Verifying transaction: ${txHash}`);
        
        // Get transaction details
        const tx = await provider.getTransaction(txHash);
        
        if (!tx) {
            console.log('❌ Transaction not found');
            return { success: false, error: 'Transaction not found' };
        }
        
        // Verify recipient is your wallet
        if (tx.to?.toLowerCase() !== recipientWallet.toLowerCase()) {
            console.log('❌ Wrong recipient');
            return { success: false, error: 'Wrong recipient address' };
        }
        
        // Verify amount
        const sentAmount = parseFloat(ethers.formatEther(tx.value));
        const expected = parseFloat(expectedAmount);
        
        if (sentAmount < expected) {
            console.log(`❌ Wrong amount: sent ${sentAmount}, expected ${expected}`);
            return { success: false, error: `Sent ${sentAmount} but expected ${expected}` };
        }
        
        // Wait for confirmation
        console.log('⏳ Waiting for confirmation...');
        const receipt = await tx.wait(1);
        
        if (receipt.status === 1) {
            console.log('✅ Payment verified successfully');
            return { 
                success: true, 
                from: tx.from,
                amount: sentAmount,
                blockNumber: receipt.blockNumber 
            };
        }
        
        return { success: false, error: 'Transaction failed' };
        
    } catch (error) {
        console.error('Verification error:', error);
        return { success: false, error: error.message };
    }
}

// Mint NFT to user
async function mintNFTToUser(userWalletAddress, pixelLevel = 8) {
    try {
        const contract = await getContractWithSigner();
        const price = await contract.getMintPrice();
        
        console.log(`🎨 Minting NFT to ${userWalletAddress} with pixel level ${pixelLevel}`);
        
        const tx = await contract.mintNFT(userWalletAddress, pixelLevel, {
            value: price
        });
        
        console.log(`📝 Transaction sent: ${tx.hash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`✅ Minted! Block: ${receipt.blockNumber}`);
        
        // Extract token ID from event
        const mintEvent = receipt.logs.find(log => {
            try {
                return log.topics[0] === ethers.id("NFTMinted(address,uint256,uint8,uint256)");
            } catch {
                return false;
            }
        });
        
        let tokenId = 'unknown';
        if (mintEvent) {
            tokenId = parseInt(mintEvent.topics[2]).toString();
        }
        
        return {
            success: true,
            transactionHash: receipt.hash,
            tokenId: tokenId,
            explorerUrl: `${CURRENT_NETWORK.explorerUrl}/tx/${receipt.hash}`
        };
        
    } catch (error) {
        console.error('Minting error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Pixelate image using Cloudinary
async function pixelateImage(imageUrl, pixelSize = 10) {
    // Cloudinary pixelation: e_pixelate:size
    const pixelatedUrl = imageUrl.replace('/upload/', `/upload/e_pixelate:${pixelSize}/`);
    return pixelatedUrl;
}

// Download and upload image to Cloudinary
async function uploadToCloudinary(imageUrl, userId) {
    try {
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.buffer();
        
        const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                { 
                    folder: `nft_uploads/${userId}`,
                    public_id: `${Date.now()}`
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(imageBuffer);
        });
        
        return uploadResult.secure_url;
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw error;
    }
}

// ==================== MAIN WEBHOOK HANDLER ====================

// In-memory user sessions (simple, no extra DB needed)
const userSessions = {};

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
    const username = update.message.from.username || 'User';
    
    // Initialize session if new user
    if (!userSessions[userId]) {
        userSessions[userId] = { step: 'start' };
    }
    
    console.log(`📨 Message from ${username} (${userId}): ${text || 'photo'}`);
    
    // ==================== COMMAND HANDLERS ====================
    
    // /start command
    if (text === '/start') {
        userSessions[userId] = { step: 'awaiting_image' };
        
        await sendMessage(chatId, 
            `🎨 **Welcome to Pixel NFT Minting Bot!**\n\n` +
            `🤖 I turn your images into unique 8-bit pixel art NFTs.\n\n` +
            `**How it works:**\n` +
            `1️⃣ Send me any image\n` +
            `2️⃣ I'll pixelate it and store it\n` +
            `3️⃣ Pay ${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}\n` +
            `4️⃣ Receive your NFT on blockchain!\n\n` +
            `**Network:** ${CURRENT_NETWORK.name} ${CURRENT_NETWORK.isTestnet ? '(Testnet - Free to test)' : ''}\n\n` +
            `📤 **Please send me your image now:**`
        );
        return;
    }
    
    // /help command
    if (text === '/help') {
        await sendMessage(chatId,
            `📖 **Help Guide**\n\n` +
            `**Commands:**\n` +
            `/start - Start minting process\n` +
            `/status - Check your order status\n` +
            `/price - Show current mint price\n` +
            `/network - Show current blockchain network\n` +
            `/help - Show this help\n\n` +
            `**Minting Steps:**\n` +
            `1. Send an image\n` +
            `2. Send payment to the wallet address provided\n` +
            `3. Send the transaction hash\n` +
            `4. Get your NFT!\n\n` +
            `**Need help?** Contact @support`
        );
        return;
    }
    
    // /price command
    if (text === '/price') {
        await sendMessage(chatId,
            `💰 **Current Price**\n\n` +
            `• Amount: ${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}\n` +
            `• Network: ${CURRENT_NETWORK.name}\n` +
            `• Contract: \`${CONTRACT_ADDRESS?.substring(0, 10)}...\``
        );
        return;
    }
    
    // /network command
    if (text === '/network') {
        await sendMessage(chatId,
            `🌐 **Blockchain Network**\n\n` +
            `• Name: ${CURRENT_NETWORK.name}\n` +
            `• Chain ID: ${CURRENT_NETWORK.chainId}\n` +
            `• Explorer: ${CURRENT_NETWORK.explorerUrl}\n` +
            `• Type: ${CURRENT_NETWORK.isTestnet ? 'Testnet 🧪' : 'Mainnet 🔴'}\n\n` +
            `${CURRENT_NETWORK.isTestnet ? '⚠️ Using testnet - no real money involved!' : '⚠️ Using mainnet - real transactions!'}`
        );
        return;
    }
    
    // /status command
    if (text === '/status') {
        const dbConnection = await connectDB();
        const orders = dbConnection.collection('orders');
        const userOrder = await orders.findOne({ userId: userId });
        
        if (!userOrder) {
            await sendMessage(chatId, "📭 You haven't started any NFT minting yet. Send /start to begin!");
        } else {
            let statusMessage = `📊 **Your NFT Status**\n\n`;
            statusMessage += `• Order ID: \`${userOrder.orderId}\`\n`;
            statusMessage += `• Status: **${userOrder.status}**\n`;
            statusMessage += `• Image: [View](${userOrder.originalImageUrl})\n`;
            
            if (userOrder.paymentHash) {
                statusMessage += `• Transaction: \`${userOrder.paymentHash.substring(0, 15)}...\`\n`;
            }
            
            if (userOrder.tokenId) {
                statusMessage += `• Token ID: ${userOrder.tokenId}\n`;
                statusMessage += `• Explorer: [View](${CURRENT_NETWORK.explorerUrl}/token/${CONTRACT_ADDRESS}?a=${userOrder.tokenId})\n`;
            }
            
            statusMessage += `\nCreated: ${new Date(userOrder.createdAt).toLocaleString()}`;
            
            await sendMessage(chatId, statusMessage);
        }
        return;
    }
    
    // ==================== STEP 1: HANDLE IMAGE UPLOAD ====================
    
    if (photo && userSessions[userId].step === 'awaiting_image') {
        const largestPhoto = photo[photo.length - 1];
        const fileId = largestPhoto.file_id;
        
        await sendMessage(chatId, "📸 **Image received!** Processing...");
        
        try {
            // Get file URL from Telegram
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file');
            }
            
            const filePath = fileData.result.file_path;
            const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${filePath}`;
            
            // Upload to Cloudinary
            await sendMessage(chatId, "☁️ Uploading to cloud storage...");
            const cloudinaryUrl = await uploadToCloudinary(imageUrl, userId);
            
            // Pixelate the image
            await sendMessage(chatId, "🎨 Creating pixel art version...");
            const pixelatedUrl = await pixelateImage(cloudinaryUrl);
            
            // Save to database
            const dbConnection = await connectDB();
            const orders = dbConnection.collection('orders');
            const orderId = 'ORD_' + userId + '_' + Date.now();
            
            await orders.insertOne({
                orderId: orderId,
                userId: userId,
                chatId: chatId,
                username: username,
                originalImageUrl: cloudinaryUrl,
                pixelatedImageUrl: pixelatedUrl,
                status: 'awaiting_payment',
                createdAt: new Date(),
                amount: NFT_PRICE,
                network: CURRENT_NETWORK.name
            });
            
            // Update session
            userSessions[userId] = {
                step: 'awaiting_payment',
                orderId: orderId,
                imageUrl: cloudinaryUrl,
                pixelatedUrl: pixelatedUrl
            };
            
            // Show pixelated preview
            await sendPhoto(chatId, pixelatedUrl, "🖼️ **Your pixelated NFT preview!**\n\n*This is what your NFT will look like.*");
            
            // Send payment instructions
            await sendMessage(chatId,
                `✅ **Image processed successfully!**\n\n` +
                `💳 **Payment Instructions**\n\n` +
                `Send **${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol}** to this wallet:\n\n` +
                `\`${YOUR_WALLET}\`\n\n` +
                `📝 **After sending payment:**\n` +
                `Reply with your **transaction hash** (TxID)\n\n` +
                `🔍 Example: \`0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0\`\n\n` +
                `⚠️ **Important:** Send from a Web3 wallet (MetaMask, Trust Wallet)\n` +
                `Your NFT will be sent to the SAME wallet you pay from!`
            );
            
        } catch (error) {
            console.error('Upload error:', error);
            await sendMessage(chatId, 
                `❌ **Failed to process image**\n\n` +
                `Error: ${error.message}\n\n` +
                `Please try again with a different image.`
            );
        }
        return;
    }
    
    // ==================== STEP 2: HANDLE TRANSACTION HASH ====================
    
    if (userSessions[userId].step === 'awaiting_payment' && text && text.startsWith('0x') && text.length >= 60) {
        const transactionHash = text.trim();
        
        await sendMessage(chatId, "🔍 **Verifying payment...** Please wait (10-20 seconds).");
        
        try {
            const dbConnection = await connectDB();
            const orders = dbConnection.collection('orders');
            
            // Check if transaction hash was already used (prevents fraud)
            const existingOrder = await orders.findOne({ paymentHash: transactionHash });
            if (existingOrder) {
                await sendMessage(chatId, 
                    "⚠️ **This transaction hash has already been used!**\n\n" +
                    "Please send a valid transaction hash for your payment."
                );
                return;
            }
            
            // Find user's pending order
            const userOrder = await orders.findOne({ 
                userId: userId, 
                status: 'awaiting_payment' 
            });
            
            if (!userOrder) {
                await sendMessage(chatId, 
                    "❌ **No pending order found**\n\n" +
                    "Please send /start to create a new NFT order."
                );
                return;
            }
            
            // Verify payment on blockchain
            const verification = await verifyPaymentOnBlockchain(transactionHash, NFT_PRICE, YOUR_WALLET);
            
            if (verification.success) {
                // Update order with payment info
                await orders.updateOne(
                    { orderId: userOrder.orderId },
                    { 
                        $set: { 
                            paymentHash: transactionHash,
                            payerWallet: verification.from,
                            paymentAmount: verification.amount,
                            status: 'payment_verified',
                            verifiedAt: new Date(),
                            blockNumber: verification.blockNumber
                        }
                    }
                );
                
                await sendMessage(chatId, "✅ **Payment verified!** Now minting your NFT...");
                
                // Mint the NFT to user's wallet
                const mintResult = await mintNFTToUser(verification.from, 8);
                
                if (mintResult.success) {
                    // Update order with minting info
                    await orders.updateOne(
                        { orderId: userOrder.orderId },
                        { 
                            $set: { 
                                status: 'completed',
                                tokenId: mintResult.tokenId,
                                mintTransactionHash: mintResult.transactionHash,
                                completedAt: new Date()
                            }
                        }
                    );
                    
                    // Send success message
                    await sendMessage(chatId,
                        `🎉 **NFT Minted Successfully!** 🎉\n\n` +
                        `✨ Your pixel art NFT is now on the blockchain!\n\n` +
                        `**Details:**\n` +
                        `• Token ID: \`${mintResult.tokenId}\`\n` +
                        `• Transaction: [View on Explorer](${mintResult.explorerUrl})\n` +
                        `• Network: ${CURRENT_NETWORK.name}\n\n` +
                        `🖼️ The NFT will appear in your wallet shortly.\n` +
                        `You can view it on OpenSea once indexed.\n\n` +
                        `Thank you for minting! 🚀`
                    );
                    
                    // Send the final pixelated NFT image
                    await sendPhoto(chatId, userOrder.pixelatedImageUrl, 
                        `🎨 **Your Pixel NFT #${mintResult.tokenId}**\n\n` +
                        `Thank you for minting! This 8-bit masterpiece is now yours forever.`
                    );
                    
                    // Update session
                    userSessions[userId].step = 'completed';
                    
                } else {
                    // Minting failed - update status
                    await orders.updateOne(
                        { orderId: userOrder.orderId },
                        { 
                            $set: { 
                                status: 'minting_failed',
                                mintError: mintResult.error
                            }
                        }
                    );
                    
                    await sendMessage(chatId,
                        `⚠️ **Payment verified but minting failed**\n\n` +
                        `Your payment was successful but there was an issue minting the NFT.\n\n` +
                        `**Error:** ${mintResult.error}\n\n` +
                        `Please contact support with your transaction hash:\n` +
                        `\`${transactionHash}\`\n\n` +
                        `We will resolve this shortly.`
                    );
                }
                
            } else {
                await sendMessage(chatId,
                    `❌ **Payment verification failed!**\n\n` +
                    `Reason: ${verification.error}\n\n` +
                    `**Possible causes:**\n` +
                    `• Wrong amount sent (need ${NFT_PRICE} ${CURRENT_NETWORK.currencySymbol})\n` +
                    `• Wrong wallet address\n` +
                    `• Transaction not confirmed yet\n\n` +
                    `Please check and send the correct transaction hash.\n\n` +
                    `Need help? Send /help`
                );
            }
            
        } catch (error) {
            console.error('Payment processing error:', error);
            await sendMessage(chatId, 
                `❌ **Error processing payment**\n\n` +
                `Something went wrong: ${error.message}\n\n` +
                `Please try again or contact support.`
            );
        }
        return;
    }
    
    // Invalid transaction hash format
    if (userSessions[userId].step === 'awaiting_payment' && text && !text.startsWith('0x') && !text.startsWith('/')) {
        await sendMessage(chatId,
            `⚠️ **Invalid transaction hash**\n\n` +
            `Transaction hashes must:\n` +
            `• Start with \`0x\`\n` +
            `• Be 66 characters long\n\n` +
            `Example: \`0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0\`\n\n` +
            `Please send the correct transaction hash from your wallet.`
        );
        return;
    }
    
    // Default response for unknown input
    if (text && !text.startsWith('/')) {
        await sendMessage(chatId, 
            `🤔 **Unknown command**\n\n` +
            `Send /start to mint an NFT\n` +
            `Send /help to see all commands\n` +
            `Send /status to check your order`
        );
    }
    
    res.status(200).send('OK');
}

// ==================== EXPORT ====================
module.exports = async (req, res) => {
    try {
        await handleWebhook(req, res);
    } catch (error) {
        console.error('Fatal error:', error);
        res.status(200).send('OK'); // Always return 200 to Telegram
    }
};
