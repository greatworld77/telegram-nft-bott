// api/metadata/[tokenId].js
// Serves NFT metadata to OpenSea, MetaMask, and other marketplaces

module.exports = async (req, res) => {
    // Enable CORS for OpenSea
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Get token ID from URL
    let tokenId = req.query.tokenId || req.url.split('/').pop().replace('.json', '');
    
    // Get environment variables
    const CLOUDINARY_BASE = process.env.CLOUDINARY_BASE_URL || 'https://res.cloudinary.com/demo/image/upload';
    const CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
    const NETWORK_NAME = process.env.BLOCKCHAIN_NETWORK || 'sepolia';
    
    // Create metadata following OpenSea standard
    const metadata = {
        name: `Pixel NFT #${tokenId}`,
        description: "A unique 8-bit pixel art NFT minted through Telegram. Each piece is uniquely generated from user-uploaded images and transformed into nostalgic pixel art.",
        image: `${CLOUDINARY_BASE}/nft_${tokenId}.png`,
        external_url: "https://t.me/YourBotUsername",
        attributes: [
            {
                trait_type: "Art Style",
                value: "8-bit Pixel Art"
            },
            {
                trait_type: "Blockchain",
                value: NETWORK_NAME === 'mainnet' ? "Ethereum" : "Ethereum Sepolia"
            },
            {
                trait_type: "Pixelation Quality",
                value: "High Definition Pixel"
            },
            {
                trait_type: "Generation",
                value: "AI-Assisted"
            },
            {
                trait_type: "Platform",
                value: "Telegram Bot"
            }
        ],
        properties: {
            files: [
                {
                    uri: `${CLOUDINARY_BASE}/nft_${tokenId}.png`,
                    type: "image/png"
                }
            ],
            category: "image",
            creators: [
                {
                    address: process.env.YOUR_WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
                    share: 100
                }
            ]
        },
        background_color: "1A1A2E",
        animation_url: null,
        youtube_url: null
    };
    
    res.status(200).json(metadata);
};
