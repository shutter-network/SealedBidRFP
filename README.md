# On-Chain Sealed Bid RFP

This repository contains a decentralized application (dapp) that facilitates the creation, submission, and secure revelation of sealed bid Request For Proposals (RFPs) on-chain. It is built with an emphasis on security, transparency, and user privacy by leveraging blockchain technology together with state-of-the-art encryption.

---

## Table of Contents

- [Motivation](#motivation)
- [Project Overview](#project-overview)
- [Features](#features)
- [Architecture & Technologies](#architecture--technologies)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Workflow Details](#workflow-details)
- [Future Improvements & Contributing](#future-improvements--contributing)
- [License](#license)
- [Contact](#contact)

---

## Motivation

The traditional RFP process often suffers from issues such as a lack of transparency, potential bias, and exposure of sensitive bid details. This project was conceived to address these challenges by:

- **Ensuring Fairness and Transparency:** By using blockchain technology, all steps—from RFP creation to bid submission and reveal—are executed on-chain, making the process auditable and immutable.
- **Securing Bid Privacy:** The application implements end-to-end encryption for bids, ensuring that bid details remain confidential until the predetermined reveal phase.
- **Eliminating Centralized Trust:** The dapp removes the need for a central authority by employing smart contracts, giving equal footing to all participants.
- **Encouraging Trustless Collaboration:** With cryptographic tools and blockchain integration, project participants can trust the system rather than relying on manual verification or third-party oversight.

This motivation underpins the design and development decisions, driving the focus on security, user autonomy, and decentralized operation.

---

## Project Overview

The On-Chain Sealed Bid RFP application is designed to seamlessly guide users through the full lifecycle of an RFP process:

1. **RFP Creation:** Users can create an RFP by entering a title, a detailed description (Markdown supported), and deadline parameters. Encryption data is retrieved and used to secure the RFP details.
2. **Bid Submission:** Bidders submit their proposals as encrypted bid details, ensuring that sensitive information remains private until the reveal phase.
3. **Bid Reveal:** Once the bidding deadlines have passed, bids are decrypted and revealed on-chain. Bidders’ details and bid content are transparently displayed for review.
4. **User Interface:** The application uses a modern, responsive design with a clean layout, interactive tabs, and expandable sections to enhance usability.

---

## Features

- **On-Chain RFP Creation:** Create and publish RFPs on-chain with clear deadlines for submissions and bid revelations.
- **Secure Bid Submission:** Encrypt bid details using Shutter integration before submitting them to the blockchain.
- **Bid Revelation Process:** Batch-reveal encrypted bids securely and automatically through smart contract functions.
- **Wallet Integration:** Seamlessly connects to MetaMask and automatically handles network switching to the Gnosis Chain.
- **Pagination & Expandable Details:** Load RFPs dynamically with pagination. Expandable details allow users to view more information or bid details on demand.
- **Markdown Support:** Supports rich text formatting in the description and bid sections using the [marked](https://github.com/markedjs/marked) Markdown parser.
- **Real-Time Status Updates:** Provides real-time status messages for each operation, helping users understand the current state of operations.

---

## Architecture & Technologies

- **Frontend:**
  - **HTML & CSS:** A responsive layout with an intuitive design featuring a header, tab-based navigation, and dynamic content sections.
  - **JavaScript (ES Modules):** Implements business logic for wallet connection, RFP creation, bid encryption/submission, and bid reveal.
  - **Libraries:** 
    - **ethers.js:** For blockchain interactions.
    - **axios:** To handle HTTP requests, particularly for Shutter API integrations.
    - **marked:** For Markdown parsing.
    - **Buffer:** To handle encryption and string conversion.
  
- **Blockchain & Smart Contracts:**
  - Deployed smart contract(s) on the **Gnosis Chain** manage RFPs and bid transactions.
  - Interacts with the blockchain for operations like creating RFPs, submitting bids, and revealing bids.

- **Encryption & Shutter API Integration:**
  - Secure bid encryption using Shutter’s API ensures that bid details remain confidential during the bidding phase.
  - Identity registration and encryption key management through API calls make the encryption process transparent and tamper-evident.

---

## Installation & Setup

### Prerequisites

- **Node.js & npm/yarn:** To run development tools and manage dependencies.
- **MetaMask:** A browser-based Ethereum wallet extension.
- **Internet Connection:** Needed to interact with blockchain nodes and the Shutter API.

### Getting Started

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/<your-username>/on-chain-sealed-bid-rfp.git
   cd on-chain-sealed-bid-rfp
   ```

2. **Install Dependencies:**
   Although most dependencies are loaded via CDNs in the HTML file, you might want to set up a local development environment:
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Configure Environment Files:**
   - **public_config.json:** Contains runtime configurations including the contract address, Shutter API base URL, and registry address.
   - **contract_abi.json:** Includes the ABI of the deployed smart contract.

4. **Run a Local Server:**
   Use a simple HTTP server to serve the files:
   ```bash
   npx http-server .
   ```
   Then navigate to `http://localhost:8080` (or the port specified) in your browser.

---

## Configuration

Before launching the application, update the following configuration files:

- **public_config.json:**  
  ```json
  {
    "contract_address": "0xYourContractAddressHere",
    "shutter_api_base": "https://api.shutter.example",
    "registry_address": "0xYourRegistryAddressHere"
  }
  ```
- **contract_abi.json:**  
  This file should include the ABI of your deployed smart contract that manages the RFP process.

Ensure that these files are accessible by the application and reflect the correct deployment parameters.

---

## Usage

### Connecting the Wallet

- Upon page load, the application automatically attempts to connect with MetaMask.
- If MetaMask is not detected, users are alerted to install it.
- The wallet connection process verifies the network and attempts to switch to the **Gnosis Chain** if required.

### Creating an RFP

1. Navigate to the **"Create RFP"** tab.
2. Enter a descriptive title, Markdown-supported description, and set the submission and reveal deadlines.
3. Click the **"Create RFP"** button. The system will:
   - Register your identity with Shutter.
   - Fetch encryption data.
   - Submit the RFP creation transaction to the blockchain.
4. The new RFP ID is displayed upon successful creation.

### Submitting a Bid

1. Go to the **"Submit Bid"** tab.
2. Provide the RFP ID and your bid details (Markdown supported).
3. Click **"Encrypt Bid"** to secure your bid using the RFP’s encryption key.
4. Once encrypted, the ciphertext is displayed (with expandable details).
5. Finally, click **"Submit Bid On-chain"** to record your bid on the blockchain.

### Revealing Bids

1. Switch to the **"Reveal Bids"** tab.
2. Enter the RFP ID for which you want to reveal the bids.
3. Click **"Reveal All Bids"**. This will:
   - Fetch the decryption key from the Shutter API.
   - Decrypt and reveal all submitted bids on-chain.
4. Revealed bid details will be formatted with Markdown and displayed in an expandable view.

### Viewing RFPs

- The home page displays a paginated list of all open RFPs.
- Expand each RFP to view its complete description, deadlines, and associated bid details.
- Buttons are provided to easily navigate to the bid submission or bid reveal functionality.

---

## Workflow Details

### Wallet & Network Connection

- **Auto Connection:** On page load, the application attempts to connect to MetaMask. If the user’s network is not on the Gnosis Chain, the app prompts the network switch.
- **Status Updates:** A status section at the top of the interface provides real-time feedback (e.g., connection status, transaction processing).

### Encryption & Shutter Integration

- **Identity Registration:** Before creating an RFP, the app registers an identity with the Shutter API. This identity is essential for managing encryption keys.
- **Encryption Data Fetching:** The app retrieves encryption data for the RFP, which is stored on-chain along with the RFP data.
- **Bid Encryption:** Bidders’ texts are encrypted using the fetched data before being sent on-chain. The encryption process uses a robust algorithm ensuring bid confidentiality.

### Smart Contract Interactions

- **RFP Operations:** The app utilizes functions like `createRFP`, `submitBid`, and `revealAllBids` provided by the smart contract.
- **Pagination:** RFPs are loaded in batches to manage on-chain data effectively and provide a smooth user experience.
- **Transaction Handling:** Each blockchain interaction (e.g., RFP creation, bid submission) is sent as a transaction. The interface displays real-time status and confirmations.

---

## Future Improvements & Contributing

### Future Improvements

- **Enhanced UI/UX:** Continue refining the interface for improved mobile responsiveness and accessibility.
- **Improved Error Handling:** Augment error messages and status feedback for a smoother user experience.
- **Feature Expansion:** Consider additional features such as bid monitoring, notifications, and detailed audit trails.
- **Security Audits:** Regular third-party audits to further secure smart contract interactions and encryption processes.

### Contributing

Contributions are welcome! If you have ideas for improvements or have found a bug, please:

1. **Fork the Repository:** Create your own branch and implement your changes.
2. **Submit a Pull Request:** Provide a detailed description of your changes.
3. **Report Issues:** Open an issue for discussions regarding potential enhancements or to report bugs.

For major changes, please start a discussion to ensure that your modifications align with the project roadmap.

---

## License

This project is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute the project in accordance with the license terms.

---

## Contact

For further questions or feedback, please reach out to:

- **Email:** [your-email@example.com](mailto:your-email@example.com)
- **GitHub:** [https://github.com/your-username](https://github.com/your-username)

