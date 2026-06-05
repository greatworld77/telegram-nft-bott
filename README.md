# 🎨 Telegram NFT Minting Bot

Turn any image into a pixel art NFT directly from Telegram!

## ✨ Features

- 📸 Upload any image via Telegram
- 🎨 Automatic 8-bit pixel art conversion
- 💳 Built-in payment verification
- 🔗 Smart contract deployment on Ethereum/Sepolia
- 🖼️ OpenSea compatible metadata
- 📊 MongoDB for order tracking
- ⚡ Hosted on Vercel (free tier)

## 🚀 Quick Deployment

### Prerequisites

1. [Telegram Bot Token](https://t.me/botfather)
2. [MongoDB Atlas](https://mongodb.com/atlas) (free tier)
3. [Cloudinary Account](https://cloudinary.com) (free tier)
4. [MetaMask Wallet](https://metamask.io)
5. [Vercel Account](https://vercel.com) (free tier)

### Step-by-Step Setup

#### 1. Deploy Smart Contract
- Go to [Remix IDE](https://remix.ethereum.org)
- Create `PixelNFT.sol` with the contract code
- Deploy to Sepolia testnet
- Copy contract address

#### 2. Environment Variables
Add these to your Vercel project:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_TOKEN` | From @BotFather |
| `MONGODB_URI` | MongoDB connection string |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |
| `NFT_CONTRACT_ADDRESS` | Your deployed contract |
| `YOUR_WALLET_ADDRESS` | Your receiving wallet |
| `BOT_WALLET_PRIVATE_KEY` | For gas payments |
| `BLOCKCHAIN_NETWORK` | `sepolia` or `mainnet` |

#### 3. Deploy to Vercel
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone)

#### 4. Set Webhook
