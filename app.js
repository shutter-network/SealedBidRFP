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
// Markdown Helper Function
// ======================
function createMarkdownDetails(text, maxLength = 200) {
  if (!text) return "";
  // Use marked.parse for full markdown conversion
  const fullHTML = marked.parse(text);
  if (text.length <= maxLength) {
    return fullHTML;
  } else {
    const snippet = text.substring(0, maxLength) + " ...";
    // Use marked.parseInline for inline markdown in summary
    return `<details><summary>${marked.parseInline(snippet)}</summary>${fullHTML}</details>`;
  }
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
        blockExplorerUrls: ['https://gnosisscan.io'],
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
  const rfpId = document.getElementById("rfpIdForBid").value;
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
    document.getElementById("ciphertextOutput").textContent = encryptedCiphertext;
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
  const rfpId = document.getElementById("rfpIdForBid").value;
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
    loadRFPs(true); // Update list
  } catch (err) {
    console.error("submitBid error:", err);
    setStatus(`Error submitting bid: ${err.message}`);
  }
}

// ======================
// E) Reveal All Bids for a given RFP (Batch reveal)
// ======================
async function revealAllBids() {
  const rfpId = document.getElementById("rfpIdForReveal").value;
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
      params: { identity: encryptionKeyObj.identity, registry: REGISTRY_ADDRESS }
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
    // Render revealed bids in markdown with expand/collapse support.
    document.getElementById("revealedBidsOutput").innerHTML = plaintextBids.map(text => createMarkdownDetails(text)).join("<hr>");
    loadRFPs(true); // Refresh list
  } catch (err) {
    console.error("revealAllBids error:", err);
    setStatus(`Error revealing bids: ${err.message}`);
  }
}

// ======================
// F) Load and Display RFPs (with pagination)
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
      let rfpDiv = document.createElement("div");
      rfpDiv.className = "list-item";
      // Render title as plain text and description as markdown (with expand if long)
      let html = `<strong>RFP ID:</strong> ${i}<br>
                  <strong>Title:</strong> ${rfp.title}<br>
                  <strong>Description:</strong> ${createMarkdownDetails(rfp.description)}<br>
                  <strong>Submission Deadline:</strong> ${formatTimestamp(rfp.submissionDeadline.toNumber())}<br>
                  <strong>Reveal Deadline:</strong> ${formatTimestamp(rfp.revealDeadline.toNumber())}<br>
                  <strong>Bids:</strong> ${bidCount}<br>`;
      rfpDiv.innerHTML = html;
      
      // Buttons for bidding and revealing
      const btnContainer = document.createElement("div");
      btnContainer.style.marginTop = "10px";
      
      // "Bid on this RFP" button
      const bidBtn = document.createElement("button");
      bidBtn.textContent = "Bid on this RFP";
      bidBtn.style.marginRight = "5px";
      bidBtn.onclick = () => {
        document.querySelector('.tab[data-tab="bid-tab"]').click();
        document.getElementById("rfpIdForBid").value = i;
      };
      btnContainer.appendChild(bidBtn);
      
      // "Reveal Bids" button (only if reveal deadline has passed)
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime >= rfp.revealDeadline.toNumber()) {
        const revealBtn = document.createElement("button");
        revealBtn.textContent = "Reveal Bids";
        revealBtn.onclick = () => {
          document.querySelector('.tab[data-tab="reveal-tab"]').click();
          document.getElementById("rfpIdForReveal").value = i;
        };
        btnContainer.appendChild(revealBtn);
      }
      rfpDiv.appendChild(btnContainer);
      
      // Display bids for this RFP
      let bidList = document.createElement("div");
      bidList.style.marginLeft = "15px";
      for (let j = 0; j < bidCount; j++) {
        const bid = await contract.bids(i, j);
        let bidContent = "";
        // If bid is revealed and it's plaintext, render markdown
        if (bid.revealed) {
          bidContent = createMarkdownDetails(bid.plaintextBid);
        } else {
          bidContent = bid.encryptedBid;
        }
        let bidDiv = document.createElement("div");
        bidDiv.className = "bid-item";
        bidDiv.innerHTML = `<strong>Bid ID:</strong> ${j}<br>
                            <strong>Bidder:</strong> ${bid.bidder}<br>
                            <strong>${bid.revealed ? "Plaintext Bid" : "Encrypted Bid"}:</strong> ${bidContent}`;
        bidList.appendChild(bidDiv);
      }
      rfpDiv.appendChild(bidList);
      container.appendChild(rfpDiv);
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
  const randomSigma = sigmaHex || "0x" + window.crypto.getRandomValues(new Uint8Array(32))
    .reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");
  return await window.shutter.encryptData(privateKeyHex, encryptionData.identity, encryptionData.eon_key, randomSigma);
}

// ======================
// Event Listeners & Auto Initialization
// ======================
document.addEventListener("DOMContentLoaded", async () => {
  // Cache bust ABI and config
  const config = await fetch("public_config.json?v=" + new Date().getTime()).then(res => res.json());
  CONTRACT_ADDRESS = config.contract_address;
  SHUTTER_API_BASE = config.shutter_api_base;
  REGISTRY_ADDRESS = config.registry_address;
  CONTRACT_ABI = await fetch("contract_abi.json?v=" + new Date().getTime()).then(res => res.json());
  
  // Hook up tab buttons
  document.getElementById("createRFP-btn").addEventListener("click", createRFP);
  document.getElementById("encryptBid-btn").addEventListener("click", encryptBidForRFP);
  document.getElementById("submitBid-btn").addEventListener("click", submitBid);
  document.getElementById("revealAllBids-btn").addEventListener("click", revealAllBids);
  document.getElementById("loadMoreRFPs-btn").addEventListener("click", () => loadRFPs());

  await connectWallet();
  await loadRFPs(true);
});
window.connectWallet = connectWallet;
