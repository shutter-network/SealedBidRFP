import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// ======================
// Global Variables
// ======================
let provider = null;
let signer = null;
let contract = null;
let contractReadOnly = null; // <-- Added read-only contract declaration

let shutterIdentity = null;
let encryptionData = null; // Used during RFP creation
let encryptedCiphertext = null; // Used for bidder encryption
let chosenRevealDeadline = null; // UNIX timestamp for reveal deadline

// For "load more" functionality; adjust as you see fit
let rfpOffset = 0;
const rfpBatchSize = 5;

let CONTRACT_ADDRESS, CONTRACT_ABI, SHUTTER_API_BASE, REGISTRY_ADDRESS;

// ======================
// Helper Functions
// ======================
function setStatus(msg) {
  console.log("STATUS:", msg);
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = "Status: " + msg;
  }
}

function createMarkdownDetails(text, maxLength = 200) {
  if (!text) return "";
  if (text.length <= maxLength) {
    return marked.parse(text);
  }
  const snippet = text.substring(0, maxLength) + " [Click to expand]";
  const fullHTML = marked.parse(text);
  return `<details class="expandable-text"><summary>${marked.parseInline(snippet)}</summary>${fullHTML}</details>`;
}

function createExpandableText(text, maxLength = 100) {
  if (!text) return "";
  if (text.length <= maxLength) {
    return text;
  }
  const snippet = text.substring(0, maxLength) + " [Click to expand]";
  return `<details class="expandable-text"><summary>${snippet}</summary><pre>${text}</pre></details>`;
}

function generateRandomHex(sizeInBytes) {
  const bytes = new Uint8Array(sizeInBytes);
  window.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleString(undefined, { timeZoneName: 'short' });
}

// ======================
// 1) Connect Wallet
// ======================
export async function connectWallet() {
  try {
    if (!window.ethereum) {
      alert("MetaMask not found!");
      return;
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.providers.Web3Provider(window.ethereum);
    const network = await provider.getNetwork();
    console.log("Connected to network:", network);

    // If needed, automatically switch to Gnosis chain
    if (network.chainId !== 100) {
      const gnosisChainParams = {
        chainId: '0x64',
        chainName: 'Gnosis Chain',
        nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
        rpcUrls: ['https://rpc.gnosischain.com'],
        blockExplorerUrls: ['https://gnosisscan.io']
      };
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [gnosisChainParams]
        });
        provider = new ethers.providers.Web3Provider(window.ethereum);
      } catch (switchError) {
        console.error("Failed to switch to Gnosis Chain:", switchError);
        setStatus("Please connect to Gnosis Chain.");
        return;
      }
    }
    signer = provider.getSigner();

    // Initialize contract
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    console.log("Loaded ABI:", CONTRACT_ABI);
    console.log("Contract available functions:", Object.keys(contract.functions));

    setStatus("Wallet connected to Gnosis Chain!");
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus("Error connecting wallet; please refresh the page.");
  }
}

// ======================
// 2) Create RFP
// ======================
async function createRFP() {
  const title = document.getElementById("rfpTitle").value.trim();
  const description = document.getElementById("rfpDescription").value.trim();
  const submissionDtVal = document.getElementById("submissionDeadline").value;
  const revealDtVal = document.getElementById("rfpRevealDeadline").value;
  const orgId = document.getElementById("orgIdForRFP").value.trim();

  if (!title || !description || !submissionDtVal || !revealDtVal || !orgId) {
    setStatus("Please fill in all fields for the RFP.");
    return;
  }
  const submissionDeadline = Math.floor(new Date(submissionDtVal).getTime() / 1000);
  let revealDeadline = Math.floor(new Date(revealDtVal).getTime() / 1000);
  if (revealDeadline <= submissionDeadline + 60) {
    // Make sure there's at least a 60-second gap
    revealDeadline = submissionDeadline + 60;
  }
  chosenRevealDeadline = revealDeadline;

  // 1) Register an identity on Shutter
  await registerIdentity(revealDeadline);
  if (!shutterIdentity) return;

  // 2) Fetch the encryption data from Shutter
  await fetchEncryptionData();
  if (!encryptionData) return;

  // 3) Save the key data we got from Shutter
  const keyData = JSON.stringify(encryptionData.message);

  setStatus("Creating RFP on-chain...");
  try {
    const numericOrgId = parseInt(orgId);
    if (isNaN(numericOrgId)) throw new Error("Invalid organisation ID");

    // call createRFP(...) in the old contract, which should be the same signature
    const tx = await contract.createRFP(
      title,
      description,
      submissionDeadline,
      revealDeadline,
      keyData,
      numericOrgId
    );
    console.log("Transaction sent for RFP creation:", tx);
    await tx.wait();
    console.log("RFP created!");

    // find the new RFP ID
    const rfpCountBN = await contract.rfpCount();
    const newRFPId = rfpCountBN.sub(1).toNumber();
    document.getElementById("rfpIdOutput").textContent = newRFPId.toString();

    setStatus(`RFP created successfully with ID ${newRFPId}`);
    rfpOffset = 0;

    // reload the organization's RFPs
    window.loadRFPsForOrganization(orgId);
  } catch (err) {
    console.error("createRFP error:", err);
    setStatus(`Error creating RFP: ${err.message}`);
  }
}

// ======================
// 3) Encrypt Bid
// ======================
async function encryptBidForRFP() {
  const rfpId = document.getElementById("rfpIdForBid").value.trim();
  const bidText = document.getElementById("bidText").value.trim();
  if (!rfpId || !bidText) {
    setStatus("Please enter the RFP ID and your bid details.");
    return;
  }
  setStatus("Fetching RFP encryption key...");

  try {
    const keyData = await contract.getRFPEncryptionKey(rfpId);
    if (!keyData) {
      setStatus("Encryption key not found for this RFP.");
      return;
    }
    const encryptionKeyObj = JSON.parse(keyData);

    setStatus("Encrypting your bid...");
    const bidHex = "0x" + Buffer.from(bidText, "utf8").toString("hex");
    encryptedCiphertext = await shutterEncryptPrivateKey(bidHex, encryptionKeyObj, null);

    document.getElementById("ciphertextOutput").innerHTML =
      createExpandableText(encryptedCiphertext, 100);
    setStatus("Bid encryption complete!");
  } catch (err) {
    console.error("encryptBidForRFP error:", err);
    setStatus(`Error encrypting bid: ${err.message}`);
  }
}

// ======================
// 4) Submit Bid
// ======================
async function submitBid() {
  const rfpId = document.getElementById("rfpIdForBid").value.trim();
  if (!rfpId) {
    setStatus("Please enter the RFP ID for your bid.");
    return;
  }
  if (!encryptedCiphertext) {
    setStatus("Please encrypt your bid first!");
    return;
  }
  setStatus("Submitting bid on-chain...");

  try {
    const tx = await contract.submitBid(rfpId, encryptedCiphertext);
    console.log("Bid submission tx sent:", tx);
    await tx.wait();
    console.log("Bid submitted!");
    setStatus("Bid submitted successfully!");

    // get new bid ID
    const rfp = await contract.rfps(rfpId);
    const bidId = rfp.bidCount.sub(1).toNumber();
    document.getElementById("bidIdOutput").textContent = bidId.toString();

    const orgId = document.getElementById("orgIdForRFP").value.trim();
    window.loadRFPsForOrganization(orgId);
  } catch (err) {
    console.error("submitBid error:", err);
    setStatus(`Error submitting bid: ${err.message}`);
  }
}

// ======================
// 5) Reveal All Bids
// ======================
async function revealAllBids() {
  const rfpId = document.getElementById("rfpIdForReveal").value.trim();
  if (!rfpId) {
    setStatus("Please enter the RFP ID.");
    return;
  }
  setStatus("Revealing all bids on-chain...");

  try {
    // fetch the RFP
    const rfp = await contract.rfps(rfpId);
    const encryptionKeyObj = JSON.parse(rfp.encryptionKey);

    // fetch final decryption key from Shutter
    const keyResp = await axios.get(`${SHUTTER_API_BASE}/get_decryption_key`, {
      params: {
        identity: encryptionKeyObj.identity,
        registry: REGISTRY_ADDRESS
      }
    });
    const finalDecryptionKey = keyResp.data?.message?.decryption_key;
    if (!finalDecryptionKey) {
      setStatus("Decryption key not available yet!");
      return;
    }

    // decrypt each bid
    const bidCount = rfp.bidCount.toNumber();
    let plaintextBids = [];
    for (let j = 0; j < bidCount; j++) {
      const bid = await contract.bids(rfpId, j);
      if (bid.encryptedBid === "0x" || bid.revealed) {
        // already revealed
        plaintextBids.push(bid.plaintextBid);
      } else {
        // decrypt it
        const decryptedHex = await window.shutter.decrypt(bid.encryptedBid, finalDecryptionKey);
        const decryptedText = Buffer.from(decryptedHex.slice(2), "hex").toString("utf8");
        plaintextBids.push(decryptedText);
      }
    }
    console.log("Plaintext bids to reveal:", plaintextBids);

    // call revealAllBids on-chain
    const tx = await contract.revealAllBids(rfpId, plaintextBids);
    console.log("Reveal-all tx sent:", tx);
    await tx.wait();

    setStatus(`All bids for RFP ${rfpId} revealed successfully!`);
    // show them in the HTML
    document.getElementById("revealedBidsOutput").innerHTML =
      plaintextBids.map(text => createMarkdownDetails(text)).join("<hr>");

    // reload the organization's RFP list
    const orgId = document.getElementById("orgIdForRFP").value.trim();
    window.loadRFPsForOrganization(orgId);
  } catch (err) {
    console.error("revealAllBids error:", err);
    setStatus(`Error revealing bids: ${err.message}`);
  }
}

// ======================
// 6) Load RFPs for a given org (uses the old contract's getOrganization())
// ======================
async function loadRFPsForOrganization(orgId) {
  try {
    const numericOrgId = parseInt(orgId);
    if (isNaN(numericOrgId)) {
      throw new Error("Invalid organisation ID");
    }
    // Use the read-only contract instance here.
    const orgData = await contractReadOnly.getOrganization(numericOrgId);
    const orgName = orgData[0];
    const rfpIds = orgData[1];

    // Optionally update display
    const activeOrgNameEl = document.getElementById("activeOrgName");
    if (activeOrgNameEl) {
      activeOrgNameEl.textContent = "Organisation: " + orgName + " (ID: " + orgId + ")";
    }

    // Build the RFP list
    const container = document.getElementById("rfpList");
    container.innerHTML = "";

    for (let idx = 0; idx < rfpIds.length; idx++) {
      const numericRfpId = ethers.BigNumber.from(rfpIds[idx]).toNumber();
      // Use the read-only instance for fetching RFP details.
      let rfp = await contractReadOnly.rfps(numericRfpId);
      const bidCount = rfp.bidCount.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);

      let status = "";
      if (currentTime < rfp.submissionDeadline.toNumber()) {
        status = "open for submission";
      } else if (currentTime < rfp.revealDeadline.toNumber()) {
        status = "reveal available";
      } else {
        let totalRevealed = 0;
        for (let j = 0; j < bidCount; j++) {
          const bid = await contractReadOnly.bids(numericRfpId, j);
          if (bid.revealed) totalRevealed++;
        }
        status =
          bidCount > 0 && totalRevealed === bidCount
            ? "finalized/revealed"
            : "reveal available";
      }

      // Build the HTML for each RFP
      const detailsElem = document.createElement("details");
      detailsElem.className = "rfp-summary";

      const summaryElem = document.createElement("summary");
      summaryElem.innerHTML = `
        <span style="font-size:15px;">${rfp.title}</span> (click to expand) | 
        <span style="color:#555;">Status:</span> <strong>${status}</strong> | 
        <span style="color:#555;">Submit by:</span> ${formatTimestamp(rfp.submissionDeadline.toNumber())} | 
        <span style="color:#555;">Bids:</span> ${bidCount} ▼
      `;
      detailsElem.appendChild(summaryElem);

      // RFP details section
      let detailsContent = document.createElement("div");
      detailsContent.className = "rfp-details";
      detailsContent.innerHTML = `
        <h3 style="margin:0 0 10px 0;">RFP ID: ${numericRfpId}</h3>
        <p><strong>Description:</strong><br> ${createMarkdownDetails(rfp.description)}</p>
        <p><strong>Submission Deadline:</strong> ${formatTimestamp(rfp.submissionDeadline.toNumber())}</p>
        <p><strong>Reveal Deadline:</strong> ${formatTimestamp(rfp.revealDeadline.toNumber())}</p>
      `;

      // Buttons container
      let btnContainer = document.createElement("div");
      btnContainer.style.marginTop = "12px";

      // Bid button or disabled state depending on the deadline
      if (currentTime < rfp.submissionDeadline.toNumber()) {
        let bidBtn = document.createElement("button");
        bidBtn.textContent = "Bid on this RFP";
        bidBtn.style.marginRight = "5px";
        bidBtn.onclick = () => {
          // Switch tab to "Submit Bid"
          document.querySelector('.tab[data-tab="bid-tab"]').click();
          document.getElementById("rfpIdForBid").value = numericRfpId;
        };
        btnContainer.appendChild(bidBtn);
      } else {
        let disabledBidBtn = document.createElement("button");
        disabledBidBtn.textContent = "Bidding Closed";
        disabledBidBtn.disabled = true;
        disabledBidBtn.style.backgroundColor = "#999";
        btnContainer.appendChild(disabledBidBtn);
      }

      // Reveal bids button (or disabled state) based on the reveal deadline
      if (currentTime >= rfp.revealDeadline.toNumber()) {
        if (status === "finalized/revealed") {
          let disabledRevealBtn = document.createElement("button");
          disabledRevealBtn.textContent = "Already Revealed";
          disabledRevealBtn.disabled = true;
          disabledRevealBtn.style.backgroundColor = "#999";
          btnContainer.appendChild(disabledRevealBtn);
        } else {
          let revealBtn = document.createElement("button");
          revealBtn.textContent = "Reveal Bids";
          revealBtn.onclick = async () => {
            try {
              await revealAllBidsDirect(numericRfpId);
            } catch (e) {
              console.error("Direct reveal failed:", e);
              document.querySelector('.tab[data-tab="reveal-tab"]').click();
              document.getElementById("rfpIdForReveal").value = numericRfpId;
            }
          };
          btnContainer.appendChild(revealBtn);
        }
      }
      
      detailsContent.appendChild(btnContainer);

      // Expandable list of bids using the read-only instance
      let bidsDetails = document.createElement("details");
      bidsDetails.className = "rfp-bids";
      let bidsSummary = document.createElement("summary");
      bidsSummary.textContent = "Show all bids (click to expand) ▼";
      bidsDetails.appendChild(bidsSummary);

      let bidList = document.createElement("div");
      bidList.style.marginLeft = "15px";
      for (let j = 0; j < bidCount; j++) {
        const bid = await contractReadOnly.bids(numericRfpId, j);
        let bidContent = "";
        if (bid.revealed) {
          bidContent = createMarkdownDetails(bid.plaintextBid);
        } else {
          bidContent = createExpandableText(bid.encryptedBid, 100);
        }
        let bidDiv = document.createElement("div");
        bidDiv.className = "bid-item";
        bidDiv.innerHTML = `
          <strong>Bid #${j}</strong> | 
          <strong>Bidder:</strong> ${bid.bidder} | 
          <strong>${bid.revealed ? "Plaintext" : "Encrypted"}:</strong> ${bidContent}
        `;
        bidList.appendChild(bidDiv);
      }
      bidsDetails.appendChild(bidList);
      detailsContent.appendChild(bidsDetails);

      detailsElem.appendChild(detailsContent);
      container.appendChild(detailsElem);
    }
  } catch (err) {
    console.error("loadRFPsForOrganization error:", err);
    setStatus("Error loading RFPs: " + err.message);
  }
}


// Attach this function to window so that rfp.html can call it inline
window.loadRFPsForOrganization = loadRFPsForOrganization;

// New helper to reveal all bids for a given RFP directly.
async function revealAllBidsDirect(rfpId) {
  // Pre-fill the reveal RFP ID input field
  document.getElementById("rfpIdForReveal").value = rfpId;
  // Call the existing revealAllBids function, which reads the input field.
  await revealAllBids();
}



// ======================
// Shutter Integration
// ======================
async function registerIdentity(decryptionTimestamp) {
  const identityPrefix = generateRandomHex(32);
  try {
    setStatus("Registering identity on Shutter...");
    const resp = await axios.post(`${SHUTTER_API_BASE}/register_identity`, {
      decryptionTimestamp,
      identityPrefix,
      registry: REGISTRY_ADDRESS
    });
    shutterIdentity = resp.data;
    setStatus("Shutter identity registered successfully!");
    console.log("Shutter Identity:", shutterIdentity);
  } catch (err) {
    console.error("registerIdentity error:", err);
    const fallbackMsg = err.response?.data?.description || "An error occurred";
    setStatus(`Error registering identity: ${fallbackMsg}`);
  }
}

async function fetchEncryptionData() {
  if (!shutterIdentity?.message?.identity_prefix) {
    setStatus("Identity prefix not found. Register the identity first!");
    return;
  }
  try {
    setStatus("Fetching Shutter encryption data...");
    const url = `${SHUTTER_API_BASE}/get_data_for_encryption?address=${REGISTRY_ADDRESS}&identityPrefix=${shutterIdentity.message.identity_prefix}`;
    const resp = await axios.get(url);
    encryptionData = resp.data;
    setStatus("Got Shutter encryption data!");
    console.log("Encryption Data:", encryptionData);
  } catch (err) {
    console.error("fetchEncryptionData error:", err);
    const fallbackMsg = err.response?.data?.description || "An error occurred";
    setStatus(`Error fetching encryption data: ${fallbackMsg}`);
  }
}

async function shutterEncryptPrivateKey(privateKeyHex, encryptionKeyObj, sigmaHex) {
  const randomSigma =
    sigmaHex ||
    "0x" +
      window.crypto
        .getRandomValues(new Uint8Array(32))
        .reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");
  return await window.shutter.encryptData(
    privateKeyHex,
    encryptionKeyObj.identity,   // from the JSON in RFP.encryptionKey
    encryptionKeyObj.eon_key,    // from that JSON
    randomSigma
  );
}

// ======================
// Initialization
// ======================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1) Load config and ABI
    const config = await fetch("public_config.json?v=" + new Date().getTime()).then(res => res.json());
    CONTRACT_ADDRESS = config.contract_address;
    SHUTTER_API_BASE = config.shutter_api_base;
    REGISTRY_ADDRESS = config.registry_address;
    
    // Use the RPC URL from config. Prefer 'rpc_url' if available.
    const rpcUrl = config.rpc_url || config.public_rpc;
    if (!rpcUrl) {
      throw new Error("RPC URL not defined in configuration.");
    }
    
    CONTRACT_ABI = await fetch("contract_abi.json?v=" + new Date().getTime()).then(res => res.json());
    
    // Create read-only provider using the RPC endpoint
    let publicRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Verify connection by detecting network
    const network = await publicRpcProvider.getNetwork();
    if (network.chainId !== 100) {  // 100 is the Gnosis Chain ID
      throw new Error(`RPC connected to wrong network (Chain ID: ${network.chainId}). Expected Gnosis (100).`);
    }
    console.log("Read-only provider connected to network:", network);
    
    // Initialize read-only contract instance for view operations
    contractReadOnly = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, publicRpcProvider);

    // 2) Connect wallet (for transactions)
    connectWallet().catch(err => console.warn("Wallet connection skipped/declined:", err));

    // 3) Prefill default deadlines (optional)
    const now = new Date();
    const submissionTime = new Date(now.getTime() + 4 * 60 * 1000);
    const revealTime = new Date(now.getTime() + 5 * 60 * 1000);
    document.getElementById("submissionDeadline").value = submissionTime.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).replace(' ', 'T').slice(0, 16);
    document.getElementById("rfpRevealDeadline").value = revealTime.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).replace(' ', 'T').slice(0, 16);
    

    // 4) Hook up button event listeners inside each tab
    document.getElementById("createRFP-btn").addEventListener("click", createRFP);
    document.getElementById("encryptBid-btn").addEventListener("click", encryptBidForRFP);
    document.getElementById("submitBid-btn").addEventListener("click", submitBid);
    document.getElementById("revealAllBids-btn").addEventListener("click", revealAllBids);

    // 5) “Load More” RFPs button – calls our load function which uses the read-only contract instance
    document.getElementById("loadMoreRFPs-btn").addEventListener("click", () => {
      const orgId = document.getElementById("orgIdForRFP").value.trim();
      window.loadRFPsForOrganization(orgId);
    });

    // 6) Tab switching functionality
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', function() {
        // Remove 'active' class from all tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        // Hide all .tab-content
        document.querySelectorAll('.tab-content').forEach(tc => {
          tc.style.display = 'none';
        });
        // Add 'active' to the clicked tab
        this.classList.add('active');
        // Show the corresponding tab content
        const tabId = this.getAttribute('data-tab');
        document.getElementById(tabId).style.display = 'block';
      });
    });

    // 7) If there's ?orgId= in the URL, load those RFPs using the read-only provider
    const urlParams = new URLSearchParams(window.location.search);
    const orgId = urlParams.get("orgId");
    if (orgId) {
      document.getElementById("orgIdForRFP").value = orgId;
      document.getElementById("activeOrgName").textContent = "Organisation: " + orgId;
      await loadRFPsForOrganization(orgId);
    } else {
      console.log("No org ID found, skipping load of RFPs for organization.");
    }

  } catch (err) {
    console.error("Error in DOMContentLoaded block:", err);
    setStatus("Error initializing page: " + err.message);
  }
});
