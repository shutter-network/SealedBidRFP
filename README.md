# Shutter Sealed Bid RFPs dApp

This is a decentralized application (dApp) built on the Gnosis Chain that allows organizations to create Requests for Proposals (RFPs) and receive confidential bids using Shutter Network's threshold encryption. Bids remain encrypted and unreadable until a predetermined "reveal deadline," ensuring a fair and sealed bidding process.

**Target Chain:** Gnosis Chain (Chain ID: 100)

---

## 🚨 IMPORTANT DISCLAIMER: Early Software & Off-Chain Decryption 🚨

* **Early Stage Software:** This dApp is currently in an early stage of development. While functional, it may contain bugs or undergo significant changes. Use it with caution and **do not rely on it for high-value or critical procurement processes without thorough independent auditing and testing.**
* **Off-Chain Decryption Verification:** The bid decryption process relies on the Shutter Network's key generation mechanism. When the reveal deadline passes, anyone (typically the RFP creator or an interested party) can fetch the final decryption key from the Shutter API. This key is then used *in the user's browser (off-chain)* to decrypt the submitted ciphertexts (bids). The resulting *plaintext* bids are then submitted to the smart contract's `revealAllBids` function.
* **Trust Assumption:** The smart contract **does not perform on-chain decryption or verify the correctness of the submitted plaintexts against the ciphertexts**. It trusts that the user calling `revealAllBids` provides the correct decryptions.
* **Potential for False Reveals:** A malicious actor *could* potentially call `revealAllBids` and submit incorrect plaintext data for one or more bids.
* **Off-Chain Verification:** **Crucially, anyone can verify the correctness of a revealed bid off-chain.** The necessary information is publicly available on the blockchain and via the Shutter API:
    1.  The encrypted bid (ciphertext) is stored in the smart contract.
    2.  The Shutter encryption key parameters (identity, eon\_key) are stored within the RFP data in the smart contract.
    3.  After the reveal deadline, the final decryption key can be fetched from the Shutter API using the identity.
    4.  Using these pieces of information and the `shutter.decrypt` function (or equivalent logic), anyone can independently decrypt the ciphertext and compare it to the plaintext stored on-chain after the reveal.

---

## Features

* **Organization Management:** Create and list organizations that can issue RFPs (via `index.html`).
* **RFP Creation:** Organizations can create RFPs with a title, detailed description (Markdown supported), submission deadline, and reveal deadline.
* **Shutter Integration:** Automatically registers an identity with Shutter Network for each RFP to generate unique encryption/decryption keys tied to the reveal deadline.
* **Sealed Bids:** Bidders submit bids that are encrypted using the Shutter-provided public key for the specific RFP. These ciphertexts are stored on-chain.
* **Timed Reveal:** Encrypted bids can only be decrypted after the specified reveal deadline when Shutter releases the final decryption key.
* **Bid Reveal:** Functionality to fetch the decryption key, decrypt bids (off-chain), and submit the plaintexts to the contract for permanent storage and viewing.
* **Frontend Interface:** Simple web interface (`index.html`, `rfp.html`, `rfp_detail.html`) for interacting with the smart contract and Shutter.
* **Read-Only Mode:** Loads organization and RFP data using a public RPC endpoint, allowing viewing without connecting a wallet.
* **Wallet Integration:** Uses MetaMask for connecting to Gnosis Chain, sending transactions (creating RFPs, submitting bids, revealing bids), and signing.

---

## Technology Stack

* **Blockchain:** Gnosis Chain
* **Smart Contracts:** Solidity
* **Encryption:** Shutter Network (Threshold Encryption)
* **Frontend:** HTML, CSS, JavaScript
* **Libraries:**
    * `ethers.js`: Ethereum blockchain interaction.
    * `axios`: HTTP requests (for Shutter API).
    * `marked`: Markdown parsing for RFP descriptions/bids.
    * `@shutter-network/shutter-crypto`: (Assumed, as `window.shutter.encryptData` and `window.shutter.decrypt` are used) - Browser library for Shutter encryption/decryption.
* **Development/Deployment:** Node.js, npm/yarn, Hardhat (recommended) or Foundry

---

## Prerequisites

* **Node.js & npm/yarn:** For managing dependencies and running scripts. [Download Node.js](https://nodejs.org/)
* **Git:** For cloning the repository. [Download Git](https://git-scm.com/)
* **MetaMask:** Browser extension wallet for interacting with the dApp. [Download MetaMask](https://metamask.io/)
* **Solidity Development Environment:** Hardhat or Foundry recommended for compiling, testing, and deploying the smart contract.
    * [Hardhat](https://hardhat.org/)
    * [Foundry](https://book.getfoundry.sh/)
* **Gnosis Chain Funds (xDAI):** Needed in the deployment wallet to pay for gas fees when deploying the contract and in user wallets for interacting with the dApp.

---

## Configuration

The frontend relies on two configuration files in the root directory (or wherever `index.html` is served from):

1.  **`public_config.json`:** Contains essential addresses and endpoints.
    ```json
    {
      "contract_address": "YOUR_DEPLOYED_CONTRACT_ADDRESS",
      "shutter_api_base": "SHUTTER_API_ENDPOINT_URL", // e.g., "[https://shutter-keycard-api.staging.protokol.xyz](https://shutter-keycard-api.staging.protokol.xyz)" (Check Shutter docs for current endpoints)
      "registry_address": "SHUTTER_REGISTRY_CONTRACT_ADDRESS_ON_GNOSIS", // Check Shutter docs for Gnosis
      "rpc_url": "YOUR_GNOSIS_CHAIN_RPC_URL" // e.g., "[https://rpc.gnosischain.com](https://rpc.gnosischain.com)" or a private one
    }
    ```
    * `contract_address`: The address where you deploy your RFP smart contract.
    * `shutter_api_base`: The URL for the Shutter Keyper API service you intend to use (e.g., staging or production).
    * `registry_address`: The address of the Shutter Registry contract on Gnosis Chain.
    * `rpc_url`: A reliable JSON-RPC endpoint for Gnosis Chain used for read-only operations.

2.  **`contract_abi.json`:** Contains the Application Binary Interface (ABI) of your compiled smart contract. This allows the frontend JavaScript to know how to interact with the contract functions. You typically get this file after compiling your Solidity contract (e.g., from Hardhat's `artifacts` directory). It should be an array (`[...]`).

---

## Deployment Instructions

Deployment involves two main steps: deploying the smart contract and hosting the frontend files.

### 1. Deploying the Smart Contract (using Hardhat example)

1.  **Clone Repository:**
    ```bash
    git clone <your-repo-url>
    cd <your-repo-directory>
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    # or yarn install
    ```

3.  **Configure Hardhat:**
    * Create or edit `hardhat.config.js`.
    * Add Gnosis Chain to the `networks` configuration. Use environment variables (with a `.env` file and `dotenv` package) to securely manage your private key and RPC URL.
    * Install `dotenv`: `npm install --save-dev dotenv`
    * Create a `.env` file in the root (add it to `.gitignore`!):
        ```env
        GNOSIS_RPC_URL="[https://rpc.gnosischain.com](https://rpc.gnosischain.com)"
        DEPLOYER_PRIVATE_KEY="YOUR_WALLET_PRIVATE_KEY_FOR_DEPLOYMENT"
        ```
    * Update `hardhat.config.js`:
        ```javascript
        require("@nomicfoundation/hardhat-toolbox");
        require("dotenv").config();

        /** @type import('hardhat/config').HardhatUserConfig */
        module.exports = {
          solidity: "0.8.20", // Use the correct Solidity version for your contract
          networks: {
            gnosis: {
              url: process.env.GNOSIS_RPC_URL || "[https://rpc.gnosischain.com](https://rpc.gnosischain.com)",
              accounts: process.env.DEPLOYER_PRIVATE_KEY !== undefined ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
              chainId: 100,
            },
            // Add other networks like localhost if needed
            localhost: {
              url: "[http://127.0.0.1:8545](http://127.0.0.1:8545)",
              chainId: 31337, // Default Hardhat Network chainId
            },
          },
          // Add other configurations like etherscan for verification if needed
        };
        ```

4.  **Compile Contract:**
    ```bash
    npx hardhat compile
    ```
    This generates artifacts, including the ABI, usually in the `artifacts/` directory.

5.  **Write Deployment Script:**
    * Create a script in the `scripts/` directory (e.g., `deployRFP.js`).
    * This script will use `ethers` (via Hardhat) to deploy your contract.
    ```javascript
    // scripts/deployRFP.js
    const hre = require("hardhat");

    async function main() {
      const rfpContractName = "YourRFPContract"; // Replace with your actual contract name

      console.log(`Deploying ${rfpContractName}...`);

      const RFPContractFactory = await hre.ethers.getContractFactory(rfpContractName);
      const rfpContract = await RFPContractFactory.deploy(/* constructor arguments if any */);

      // await rfpContract.deployed(); // DEPRECATED in ethers v6+
      await rfpContract.waitForDeployment(); // Use this for ethers v6+ (Hardhat might still use v5 internally)

      const contractAddress = await rfpContract.getAddress(); // For ethers v6+
      // const contractAddress = rfpContract.address; // For ethers v5

      console.log(`${rfpContractName} deployed to: ${contractAddress}`);
      console.log(`Network: ${hre.network.name} (Chain ID: ${hre.network.config.chainId})`);

      // Optional: You might want to log constructor arguments or perform post-deployment setup
    }

    main().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    ```
    *Replace `"YourRFPContract"` with the actual name of your Solidity contract.*

6.  **Deploy to Gnosis Chain:**
    * Ensure your deployment wallet (whose private key is in `.env`) has sufficient xDAI for gas.
    * Run the script targeting the Gnosis network:
        ```bash
        npx hardhat run scripts/deployRFP.js --network gnosis
        ```

7.  **Record Contract Address:** Note the deployed contract address output by the script. You will need this for the frontend configuration.

8.  **Get Contract ABI:** Copy the ABI array from the generated artifact file (e.g., `artifacts/contracts/YourRFPContract.sol/YourRFPContract.json`) and save it as `contract_abi.json` in your frontend directory. Make sure it's just the JSON array `[...]`.

### 2. Hosting the Frontend

1.  **Prepare Frontend Files:** Gather all necessary frontend files:
    * `index.html`
    * `rfp.html`
    * `rfp_detail.html` (if applicable)
    * Any CSS files (`style.css`, etc.)
    * The main JavaScript files (like the ones provided in the prompt, potentially named `app.js`, `orgs.js` etc.)
    * Dependency libraries (ensure `ethers.esm.min.js`, `axios`, `buffer`, `marked`, and the Shutter crypto library are correctly referenced or included). The provided code uses CDN links, which is simple for deployment.
    * `public_config.json` (UPDATED)
    * `contract_abi.json` (UPDATED)

2.  **Update `public_config.json`:** Edit `public_config.json` in your frontend directory:
    * Set `contract_address` to the address you recorded after deploying the smart contract.
    * Set `shutter_api_base` to the correct Shutter API endpoint.
    * Set `registry_address` to the correct Shutter Registry contract address on Gnosis.
    * Set `rpc_url` to a reliable Gnosis RPC endpoint.

3.  **Choose Hosting Platform:** Select where to host these static files. Options include:
    * **Static Hosting Services:** Netlify, Vercel, Cloudflare Pages, GitHub Pages (Good for simplicity and CI/CD).
    * **Decentralized Storage:** IPFS via services like Fleek, Pinata, or 4everland (Aligns well with dApp ethos).
    * **Traditional Web Server:** Apache, Nginx on a VPS.

4.  **Deploy Frontend:**
    * **Static Hosts (Netlify/Vercel/Cloudflare):** Connect your Git repository or upload the folder containing all frontend files. Configure the build command if necessary (likely none needed for simple HTML/JS).
    * **IPFS (e.g., Fleek):** Upload the folder containing all frontend files. Fleek will provide an IPFS hash and potentially a human-readable domain.
    * **Traditional Server:** Use FTP, SCP, or SSH to upload the files to your server's webroot directory.

5.  **Access the dApp:** Navigate to the URL provided by your hosting platform.

---

## Usage Flow

1.  **Landing Page (`index.html`):**
    * Displays a list of existing organizations loaded via RPC.
    * Users can click an organization to view its RFPs (`rfp.html?orgId=...`).
    * Users can connect their MetaMask wallet (prompted automatically or via a button).
    * Once connected to Gnosis Chain, users can enter a name and click "Create Organisation" to add a new one via a transaction.

2.  **Organization RFP Page (`rfp.html`):**
    * Displays RFPs for the selected organization (loaded via RPC).
    * Shows RFP details (title, description, deadlines, status, bid count).
    * Provides buttons to:
        * **Create New RFP:** (Requires connected wallet) Fill in details, deadlines. This registers with Shutter and deploys the RFP on-chain.
        * **Bid on this RFP:** (Requires connected wallet, before submission deadline) Takes user to the bidding section, pre-filling the RFP ID.
        * **Reveal Bids:** (Requires connected wallet, after reveal deadline) Takes user to the reveal section, pre-filling the RFP ID. Or, directly triggers the reveal process.
        * **View RFP Page:** Links to a dedicated page for the RFP (`rfp_detail.html?orgId=...&rfpId=...`).
    * Displays submitted bids (ciphertext before reveal, plaintext after).

3.  **Interaction Tabs (likely within `rfp.html` or separate pages):**
    * **Create RFP:** Form for title, description, deadlines, org ID.
    * **Submit Bid:** Enter RFP ID, write bid text (Markdown), encrypt the bid (uses Shutter key fetched from the contract), submit the encrypted bid transaction.
    * **Reveal Bids:** Enter RFP ID. Fetches decryption key from Shutter (after deadline), decrypts all bids locally, submits the plaintexts via the `revealAllBids` transaction. Displays revealed plaintexts.

---

## Development

1.  **Clone:** `git clone ...`
2.  **Install:** `npm install`
3.  **Compile Contracts:** `npx hardhat compile`
4.  **Run Local Node:** `npx hardhat node`
5.  **Deploy Locally:** `npx hardhat run scripts/deployRFP.js --network localhost` (Update `public_config.json` with local contract address and RPC `http://127.0.0.1:8545`).
6.  **Run Tests:** `npx hardhat test`
7.  **Serve Frontend Locally:** Use a simple HTTP server like `http-server` (`npm install -g http-server`, then run `http-server .` in the frontend directory). Access via `http://localhost:8080`. Connect MetaMask to `localhost:8545`.