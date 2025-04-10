import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// ======================
// Global Variables
// ======================
let provider = null;
let signer = null;
let contract = null;

let shutterIdentity = null;
let encryptionData = null; // Used during RFP creation
let encryptedCiphertext = null; // Used for bidder encryption
let chosenRevealDeadline = null; // UNIX timestamp for reveal deadline

// Pagination for RFP list
let rfpOffset = 0;
const rfpBatchSize = 5;

let CONTRACT_ADDRESS, CONTRACT_ABI, SHUTTER_API_BASE, REGISTRY_ADDRESS;

// ======================
// Helper Functions for Expandable Text
// ======================
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

// ======================
// Utility Functions
// ======================
function setStatus(msg) {
  console.log("STATUS:", msg);
  document.getElementById("status").textContent = "Status: " + msg;
}

function generateRandomHex(sizeInBytes) {
  const bytes = new Uint8Array(sizeInBytes);
  window.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

// ======================
// A) Connect Wallet (auto on page load)
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
    if (network.chainId !== 100) {
      const gnosisChainParams = {
        chainId: '0x64',
        chainName: 'Gnosis Chain',
        nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
        rpcUrls: ['https://rpc.gnosischain.com'],
        blockExplorerUrls: ['https://gnosisscan.io']
      };
      try {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [gnosisChainParams] });
        provider = new ethers.providers.Web3Provider(window.ethereum);
      } catch (switchError) {
        console.error("Failed to switch to Gnosis Chain:", switchError);
        setStatus("Please connect to Gnosis Chain.");
        return;
      }
    }
    signer = provider.getSigner();
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
// B) RFP Creation
// ======================
async function createRFP() {
  const title = document.getElementById("rfpTitle").value.trim();
  const description = document.getElementById("rfpDescription").value.trim();
  const submissionDtVal = document.getElementById("submissionDeadline").value;
  const revealDtVal = document.getElementById("rfpRevealDeadline").value;
  if (!title || !description || !submissionDtVal || !revealDtVal) {
    setStatus("Please fill in all fields for the RFP.");
    return;
  }
  const submissionDeadline = Math.floor(new Date(submissionDtVal).getTime() / 1000);
  let revealDeadline = Math.floor(new Date(revealDtVal).getTime() / 1000);
  // Ensure reveal deadline is at least 60 seconds after submission
  if (revealDeadline <= submissionDeadline + 60) {
    revealDeadline = submissionDeadline + 60;
  }
  chosenRevealDeadline = revealDeadline;
  
  await registerIdentity(revealDeadline);
  if (!shutterIdentity) return;
  await fetchEncryptionData();
  if (!encryptionData) return;
  
  const keyData = JSON.stringify(encryptionData.message);
  setStatus("Creating RFP on-chain...");
  try {
    const tx = await contract.createRFP(title, description, submissionDeadline, revealDeadline, keyData);
    console.log("Transaction sent for RFP creation:", tx);
    await tx.wait();
    console.log("RFP created!");
    const rfpCountBN = await contract.rfpCount();
    const newRFPId = rfpCountBN.sub(1).toNumber();
    document.getElementById("rfpIdOutput").textContent = newRFPId.toString();
    setStatus(`RFP created successfully with ID ${newRFPId}`);
    rfpOffset = 0; // Reset pagination
    loadRFPs(true);
  } catch (err) {
    console.error("createRFP error:", err);
    setStatus(`Error creating RFP: ${err.message}`);
  }
}

// ======================
// C) Encrypt Bid for RFP
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
    document.getElementById("ciphertextOutput").innerHTML = createExpandableText(encryptedCiphertext, 100);
    setStatus("Bid encryption complete!");
  } catch (err) {
    console.error("encryptBidForRFP error:", err);
    setStatus(`Error encrypting bid: ${err.message}`);
  }
}

// ======================
// D) Submit Bid (On-chain) for an RFP
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
    const rfp = await contract.rfps(rfpId);
    const bidId = rfp.bidCount.sub(1).toNumber();
    document.getElementById("bidIdOutput").textContent = bidId.toString();
    loadRFPs(true);
  } catch (err) {
    console.error("submitBid error:", err);
    setStatus(`Error submitting bid: ${err.message}`);
  }
}

// ======================
// E) Reveal All Bids for a given RFP (Batch reveal)
// ======================
async function revealAllBids() {
  const rfpId = document.getElementById("rfpIdForReveal").value.trim();
  if (!rfpId) {
    setStatus("Please enter the RFP ID.");
    return;
  }
  setStatus("Revealing all bids on-chain...");
  try {
    console.log("Available functions:", Object.keys(contract.functions));
    const rfp = await contract.rfps(rfpId);
    const encryptionKeyObj = JSON.parse(rfp.encryptionKey);
    console.log("Retrieved encryptionKeyObj:", encryptionKeyObj);
    
    const keyResp = await axios.get(`${SHUTTER_API_BASE}/get_decryption_key`, {
      params: {
        identity: encryptionKeyObj.identity,
        registry: REGISTRY_ADDRESS
      }
    });
    console.log("Decryption key response:", keyResp.data);
    const finalDecryptionKey = keyResp.data?.message?.decryption_key;
    if (!finalDecryptionKey) {
      setStatus("Decryption key not available yet!");
      return;
    }
    const bidCount = rfp.bidCount.toNumber();
    let plaintextBids = [];
    for (let j = 0; j < bidCount; j++) {
      const bid = await contract.bids(rfpId, j);
      if (bid.encryptedBid === "0x" || bid.revealed) {
        plaintextBids.push(bid.plaintextBid);
      } else {
        const decryptedHex = await window.shutter.decrypt(bid.encryptedBid, finalDecryptionKey);
        const decryptedText = Buffer.from(decryptedHex.slice(2), "hex").toString("utf8");
        plaintextBids.push(decryptedText);
      }
    }
    console.log("Plaintext bids to reveal:", plaintextBids);
    console.log("Calling revealAllBids with rfpId:", rfpId, "and plaintextBids:", plaintextBids);
    const tx = await contract.revealAllBids(rfpId, plaintextBids);
    console.log("Reveal-all tx sent:", tx);
    await tx.wait();
    setStatus(`All bids for RFP ${rfpId} revealed successfully!`);
    document.getElementById("revealedBidsOutput").innerHTML =
      plaintextBids.map(text => createMarkdownDetails(text)).join("<hr>");
    loadRFPs(true);
  } catch (err) {
    console.error("revealAllBids error:", err);
    setStatus(`Error revealing bids: ${err.message}`);
  }
}

// ======================
// F) Load and Display RFPs (with pagination, compact summary)
// ======================
async function loadRFPs(refresh = false) {
  try {
    const rfpCountBN = await contract.rfpCount();
    const totalRFPs = rfpCountBN.toNumber();
    const container = document.getElementById("rfpList");
    if (refresh) {
      container.innerHTML = "";
      rfpOffset = 0;
    }
    let startIndex = totalRFPs - 1 - rfpOffset;
    let endIndex = Math.max(startIndex - rfpBatchSize + 1, 0);
    for (let i = startIndex; i >= endIndex; i--) {
      let rfp = await contract.rfps(i);
      const bidCount = rfp.bidCount.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);

      // Determine status based on deadlines and revealed bids:
      let status = "";
      if (currentTime < rfp.submissionDeadline.toNumber()) {
        status = "open for submission";
      } else if (currentTime < rfp.revealDeadline.toNumber()) {
        status = "reveal available";
      } else {
        // After the reveal deadline, check if all bids are revealed:
        let totalRevealed = 0;
        for (let j = 0; j < bidCount; j++) {
          const bid = await contract.bids(i, j);
          if (bid.revealed) totalRevealed++;
        }
        status = (bidCount > 0 && totalRevealed === bidCount) ? "finalized/revealed" : "reveal available";
      }

      // Create a <details> container for the RFP summary
      let detailsElem = document.createElement("details");
      detailsElem.className = "rfp-summary";
      let summaryElem = document.createElement("summary");
      summaryElem.innerHTML = `
        <span style="font-size:15px;">${rfp.title}</span> (click to expand) | 
        <span style="color:#555;">Status:</span> <strong>${status}</strong> | 
        <span style="color:#555;">Submit by:</span> ${formatTimestamp(rfp.submissionDeadline.toNumber())} | 
        <span style="color:#555;">Bids:</span> ${bidCount} ▼
      `;
      detailsElem.appendChild(summaryElem);

      // Expanded details content
      let detailsContent = document.createElement("div");
      detailsContent.className = "rfp-details";
      detailsContent.innerHTML = `
        <h3 style="margin:0 0 10px 0;">RFP ID: ${i}</h3>
        <p><strong>Description:</strong><br> ${createMarkdownDetails(rfp.description)}</p>
        <p><strong>Submission Deadline:</strong> ${formatTimestamp(rfp.submissionDeadline.toNumber())}</p>
        <p><strong>Reveal Deadline:</strong> ${formatTimestamp(rfp.revealDeadline.toNumber())}</p>
      `;

      // Action buttons: "Bid on this RFP" / "Reveal Bids"
      let btnContainer = document.createElement("div");
      btnContainer.style.marginTop = "12px";
      let bidBtn = document.createElement("button");
      bidBtn.textContent = "Bid on this RFP";
      bidBtn.style.marginRight = "5px";
      bidBtn.onclick = () => {
        document.querySelector('.tab[data-tab="bid-tab"]').click();
        document.getElementById("rfpIdForBid").value = i;
      };
      btnContainer.appendChild(bidBtn);
      if (currentTime >= rfp.revealDeadline.toNumber()) {
        let revealBtn = document.createElement("button");
        revealBtn.textContent = "Reveal Bids";
        revealBtn.onclick = () => {
          document.querySelector('.tab[data-tab="reveal-tab"]').click();
          document.getElementById("rfpIdForReveal").value = i;
        };
        btnContainer.appendChild(revealBtn);
      }
      detailsContent.appendChild(btnContainer);

      // Nested expandable details for bids
      let bidsDetails = document.createElement("details");
      bidsDetails.className = "rfp-bids";
      let bidsSummary = document.createElement("summary");
      bidsSummary.textContent = "Show all bids (click to expand) ▼";
      bidsDetails.appendChild(bidsSummary);
      let bidList = document.createElement("div");
      bidList.style.marginLeft = "15px";
      for (let j = 0; j < bidCount; j++) {
        const bid = await contract.bids(i, j);
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
    rfpOffset += rfpBatchSize;
    const loadMoreBtn = document.getElementById("loadMoreRFPs-btn");
    loadMoreBtn.style.display = (rfpOffset >= totalRFPs) ? "none" : "block";
  } catch (err) {
    console.error("loadRFPs error:", err);
    setStatus("Error loading RFPs: " + err.message);
  }
}

// ======================
// Shutter Integration Functions
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
    setStatus(`Error registering identity: ${err.response?.data?.description || "An error occurred"}`);
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
    setStatus(`Error fetching encryption data: ${err.response?.data?.description || "An error occurred"}`);
  }
}

async function shutterEncryptPrivateKey(privateKeyHex, encryptionData, sigmaHex) {
  // Create a random sigma if not provided
  const randomSigma = sigmaHex || "0x" + window.crypto.getRandomValues(new Uint8Array(32))
    .reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");
  return await window.shutter.encryptData(privateKeyHex, encryptionData.identity, encryptionData.eon_key, randomSigma);
}

// ======================
// Event Listeners & Auto Initialization
// ======================
document.addEventListener("DOMContentLoaded", async () => {
  const config = await fetch("public_config.json?v=" + new Date().getTime()).then(res => res.json());
  CONTRACT_ADDRESS = config.contract_address;
  SHUTTER_API_BASE = config.shutter_api_base;
  REGISTRY_ADDRESS = config.registry_address;
  CONTRACT_ABI = await fetch("contract_abi.json?v=" + new Date().getTime()).then(res => res.json());
  
  // Prefill deadlines: submission = 4 minutes, reveal = 5 minutes from now
  const now = new Date();
  const submissionTime = new Date(now.getTime() + 4 * 60 * 1000);
  const revealTime = new Date(now.getTime() + 5 * 60 * 1000);
  document.getElementById("submissionDeadline").value = submissionTime.toISOString().slice(0, 16);
  document.getElementById("rfpRevealDeadline").value = revealTime.toISOString().slice(0, 16);
  
  // Hook up event listeners
  document.getElementById("createRFP-btn").addEventListener("click", createRFP);
  document.getElementById("encryptBid-btn").addEventListener("click", encryptBidForRFP);
  document.getElementById("submitBid-btn").addEventListener("click", submitBid);
  document.getElementById("revealAllBids-btn").addEventListener("click", revealAllBids);
  document.getElementById("loadMoreRFPs-btn").addEventListener("click", () => loadRFPs());
  
  // Connect wallet and load initial RFPs
  await connectWallet();
  await loadRFPs(true);
});

window.connectWallet = connectWallet;
