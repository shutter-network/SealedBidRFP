import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// ======================
// Global Variables
// ======================
let provider = null;
let signer = null;
let contract = null;
let contractReadOnly = null;
let encryptedCiphertext = null;
let CONTRACT_ADDRESS, CONTRACT_ABI, SHUTTER_API_BASE, REGISTRY_ADDRESS;

// ======================
// Helper Functions
// ======================
function setStatus(msg) {
  console.log("STATUS:", msg);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "Status: " + msg;
}

function createMarkdownDetails(text, maxLength = 200) {
  if (!text) return "";
  if (text.length <= maxLength) return marked.parse(text);
  const snippet = text.substring(0, maxLength) + " [Click to expand]";
  return `<details><summary>${marked.parseInline(snippet)}</summary>${marked.parse(text)}</details>`;
}

function createExpandableText(text, maxLength = 100) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const snippet = text.substring(0, maxLength) + " [Click to expand]";
  return `<details><summary>${snippet}</summary><pre>${text}</pre></details>`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleString(undefined, { timeZoneName: 'short' });
}

function generateRandomHex(sizeInBytes) {
  const bytes = new Uint8Array(sizeInBytes);
  window.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function shutterEncryptPrivateKey(privateHex, keyObj) {
  const randomSigma = generateRandomHex(32);
  return await window.shutter.encryptData(
    privateHex,
    keyObj.identity,
    keyObj.eon_key || keyObj.eonKey,
    randomSigma
  );
}

// ======================
// 1) Connect Wallet
// ======================
async function connectWallet() {
  try {
    if (!window.ethereum) {
      alert("MetaMask not found!");
      return;
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.providers.Web3Provider(window.ethereum);
    const network = await provider.getNetwork();
    if (network.chainId !== 100) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x64',
          chainName: 'Gnosis Chain',
          nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
          rpcUrls: ['https://rpc.gnosischain.com'],
          blockExplorerUrls: ['https://gnosisscan.io']
        }]
      });
      provider = new ethers.providers.Web3Provider(window.ethereum);
    }
    signer = provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    setStatus("Wallet connected to Gnosis Chain!");
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus("Error connecting wallet; please refresh the page.");
  }
}

// ======================
// 2) Load and Display RFP Details (above bids)
// ======================
async function loadRFPDetails(orgId, rfpId) {
  try {
    // Organisation
    const orgData = await contractReadOnly.getOrganization(parseInt(orgId));
    document.getElementById("activeOrgName").textContent = `Organisation: ${orgData[0]} (ID: ${orgId})`;

    // RFP
    const rfp = await contractReadOnly.rfps(parseInt(rfpId));
    document.getElementById("activeRfpTitle").textContent = `RFP: ${rfp.title} (ID: ${rfpId})`;

    // Insert details above bids
    const detailsHTML = `
      <div class="section">
        <h2>RFP Details</h2>
        <p><strong>Description:</strong><br>${createMarkdownDetails(rfp.description)}</p>
        <p><strong>Submission Deadline:</strong> ${formatTimestamp(rfp.submissionDeadline.toNumber())}</p>
        <p><strong>Reveal Deadline:</strong> ${formatTimestamp(rfp.revealDeadline.toNumber())}</p>
      </div>`;
    const container = document.querySelector('.container');
    const bidsSection = document.getElementById('bidsSection');
    container.insertBefore(
      document.createRange().createContextualFragment(detailsHTML),
      bidsSection
    );
  } catch (err) {
    console.error("loadRFPDetails error:", err);
    setStatus("Error loading RFP details: " + err.message);
  }
}

// ======================
// 3) Load Bids for this RFP
// ======================
async function loadBids(rfpId) {
  const bidsSection = document.getElementById('bidsSection');
  const bidList = document.getElementById('bidList');
  bidList.innerHTML = '';
  try {
    const rfp = await contractReadOnly.rfps(parseInt(rfpId));
    const bidCount = rfp.bidCount.toNumber();
    if (bidCount === 0) {
      bidList.innerHTML = '<p>No bids yet.</p>';
    } else {
      for (let i = 0; i < bidCount; i++) {
        const bid = await contractReadOnly.bids(rfpId, i);
        const content = bid.revealed
          ? createMarkdownDetails(bid.plaintextBid)
          : createExpandableText(bid.encryptedBid, 100);
        const bidDiv = document.createElement('div');
        bidDiv.className = 'bid-item';
        bidDiv.innerHTML = `
          <strong>Bid #${i}</strong> | 
          <strong>Bidder:</strong> ${bid.bidder} | 
          <strong>${bid.revealed ? 'Plaintext' : 'Encrypted'}:</strong> ${content}`;
        bidList.appendChild(bidDiv);
      }
    }
    bidsSection.style.display = 'block';
  } catch (err) {
    console.error("loadBids error:", err);
    setStatus('Error loading bids: ' + err.message);
  }
}

// ======================
// 4) Encrypt Bid
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
    const keyObj = JSON.parse(keyData);
    setStatus("Encrypting your bid...");
    const bidHex = "0x" + Buffer.from(bidText, "utf8").toString("hex");
    encryptedCiphertext = await shutterEncryptPrivateKey(bidHex, keyObj);
    document.getElementById("ciphertextOutput").innerHTML = createExpandableText(encryptedCiphertext, 100);
    setStatus("Bid encryption complete!");
  } catch (err) {
    console.error("encryptBidForRFP error:", err);
    setStatus(`Error encrypting bid: ${err.message}`);
  }
}

// ======================
// 5) Submit Bid
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
    await tx.wait();
    setStatus("Bid submitted successfully!");
    const rfp = await contract.rfps(rfpId);
    const bidId = rfp.bidCount.sub(1).toNumber();
    document.getElementById("bidIdOutput").textContent = bidId.toString();
    loadBids(rfpId);
  } catch (err) {
    console.error("submitBid error:", err);
    setStatus(`Error submitting bid: ${err.message}`);
  }
}

// ======================
// 6) Reveal All Bids
// ======================
async function revealAllBids() {
  const rfpId = document.getElementById("rfpIdForReveal").value.trim();
  if (!rfpId) {
    setStatus("Please enter the RFP ID.");
    return;
  }
  setStatus("Revealing all bids on-chain...");
  try {
    const rfp = await contract.rfps(rfpId);
    const encryptionKeyObj = JSON.parse(rfp.encryptionKey);
    const keyResp = await axios.get(`${SHUTTER_API_BASE}/get_decryption_key`, {
      params: { identity: encryptionKeyObj.identity, registry: REGISTRY_ADDRESS }
    });
    const finalDecryptionKey = keyResp.data?.message?.decryption_key;
    if (!finalDecryptionKey) {
      setStatus("Decryption key not available yet!");
      return;
    }
    const bidCount = rfp.bidCount.toNumber();
    const plaintextBids = [];
    for (let j = 0; j < bidCount; j++) {
      const bid = await contract.bids(rfpId, j);
      if (bid.encryptedBid === "0x" || bid.revealed) {
        plaintextBids.push(bid.plaintextBid);
      } else {
        const decryptedHex = await window.shutter.decrypt(bid.encryptedBid, finalDecryptionKey);
        plaintextBids.push(Buffer.from(decryptedHex.slice(2), "hex").toString("utf8"));
      }
    }
    const tx = await contract.revealAllBids(rfpId, plaintextBids);
    await tx.wait();
    setStatus(`All bids for RFP ${rfpId} revealed successfully!`);
    document.getElementById("revealedBidsOutput").innerHTML = plaintextBids.map(text => createMarkdownDetails(text)).join("<hr>");
    loadBids(rfpId);
  } catch (err) {
    console.error("revealAllBids error:", err);
    setStatus(`Error revealing bids: ${err.message}`);
  }
}

// ======================
// Initialization
// ======================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Load config and ABI
    const config = await fetch(`public_config.json?v=${Date.now()}`).then(res => res.json());
    CONTRACT_ADDRESS = config.contract_address;
    SHUTTER_API_BASE = config.shutter_api_base;
    REGISTRY_ADDRESS = config.registry_address;
    CONTRACT_ABI = await fetch(`contract_abi.json?v=${Date.now()}`).then(res => res.json());

    // Read-only provider
    const rpcUrl = config.rpc_url || config.public_rpc;
    const publicRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
    contractReadOnly = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, publicRpcProvider);

    // Connect wallet
    await connectWallet();

    // URL params and setup
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const rfpId = params.get("rfpId");
    document.getElementById("rfpIdForBid").value = rfpId;
    document.getElementById("rfpIdForReveal").value = rfpId;
    document.getElementById("backLink").href = `rfp.html?orgId=${orgId}`;

    // Load details and bids
    await loadRFPDetails(orgId, rfpId);
    await loadBids(rfpId);

    // Event listeners
    document.getElementById("encryptBid-btn").addEventListener("click", encryptBidForRFP);
    document.getElementById("submitBid-btn").addEventListener("click", submitBid);
    document.getElementById("revealAllBids-btn").addEventListener("click", revealAllBids);
  } catch (err) {
    console.error("Init error:", err);
    setStatus("Error initializing page: " + err.message);
  }
});
