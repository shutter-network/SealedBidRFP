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
let encryptionData = null; // Used when creating RFPs
let encryptedCiphertext = null; // Used for bidder’s encryption
let chosenRevealDeadline = null; // timestamp from RFP reveal deadline

let CONTRACT_ADDRESS, CONTRACT_ABI, SHUTTER_API_BASE, REGISTRY_ADDRESS;

// ======================
// Utility Functions
// ======================
function setStatus(msg) {
  document.getElementById("status").textContent = "Status: " + msg;
}

function generateRandomHex(sizeInBytes) {
  const bytes = new Uint8Array(sizeInBytes);
  window.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

// ======================
// A) Connect Wallet
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

    // Ensure wallet is on Gnosis Chain (chainId 100)
    if (network.chainId !== 100) {
      const gnosisChainParams = {
        chainId: '0x64',
        chainName: 'Gnosis Chain',
        nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
        rpcUrls: ['https://rpc.gnosischain.com'],
        blockExplorerUrls: ['https://gnosisscan.io'],
      };

      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [gnosisChainParams],
        });
        provider = new ethers.providers.Web3Provider(window.ethereum);
      } catch (switchError) {
        console.error("Failed to switch to Gnosis Chain:", switchError);
        setStatus("Please connect to the Gnosis Chain network.");
        return;
      }
    }

    signer = provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    setStatus("Wallet connected to Gnosis Chain!");
  } catch (err) {
    console.error("connectWallet error:", err);
    setStatus("Error connecting wallet, please refresh the page.");
  }
}

// ======================
// B) RFP Creation (For RFP Creator)
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

  // Convert date/time to UNIX timestamps (in seconds)
  const submissionDeadline = Math.floor(new Date(submissionDtVal).getTime() / 1000);
  let revealDeadline = Math.floor(new Date(revealDtVal).getTime() / 1000);
  // Enforce a minimum gap (e.g., reveal must be at least 60 seconds after submission)
  if (revealDeadline <= submissionDeadline + 60) {
    revealDeadline = submissionDeadline + 60;
  }
  chosenRevealDeadline = revealDeadline;

  // Use Shutter to generate encryption parameters for this RFP.
  // (Reuse your shutter identity registration flow.)
  await registerIdentity(revealDeadline);
  if (!shutterIdentity) return;
  await fetchEncryptionData();
  if (!encryptionData) return;

  // We store the encryption key as a JSON string.
  const keyData = JSON.stringify(encryptionData.message);
  setStatus("Creating RFP on-chain...");
  try {
    const tx = await contract.createRFP(
      title,
      description,
      submissionDeadline,
      revealDeadline,
      keyData
    );
    console.log("Transaction sent for RFP creation:", tx);
    await tx.wait();
    console.log("RFP created!");
    const rfpCount = await contract.rfpCount();
    const newRFPId = rfpCount.sub(1).toNumber();
    document.getElementById("rfpIdOutput").textContent = newRFPId.toString();
    setStatus(`RFP created successfully with ID ${newRFPId}`);
  } catch (err) {
    console.error("createRFP error:", err);
    setStatus(`Error creating RFP: ${err.message}`);
  }
}

// ======================
// C) Bidder Flow: Encrypt Bid for RFP
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
    // Get the encryption key stored on-chain for the RFP
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
// D) Submit Bid (On-chain) for a given RFP
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
  } catch (err) {
    console.error("submitBid error:", err);
    setStatus(`Error submitting bid: ${err.message}`);
  }
}

// ======================
// E) Reveal Bid (Bidder reveals their bid after reveal deadline)
// ======================
async function revealBid() {
  const rfpId = document.getElementById("rfpIdForReveal").value;
  const bidId = document.getElementById("bidIdForReveal").value;
  if (!rfpId || !bidId) {
    setStatus("Please enter both the RFP ID and Bid ID.");
    return;
  }
  setStatus("Revealing bid on-chain...");
  try {
    // For simplicity, we assume the bidder reuses the plaintext bid input they had entered
    const plaintextBid = document.getElementById("bidText").value.trim();
    if (!plaintextBid) {
      setStatus("Plaintext bid not found. Please re-enter your bid details.");
      return;
    }
    const tx = await contract.revealBid(rfpId, bidId, plaintextBid);
    console.log("Reveal tx sent:", tx);
    await tx.wait();
    setStatus("Bid revealed successfully!");
    document.getElementById("decryptedOutput").textContent = plaintextBid;
  } catch (err) {
    console.error("revealBid error:", err);
    setStatus(`Error revealing bid: ${err.message}`);
  }
}

// ======================
// F) Load and Display All RFPs with Their Bids
// ======================
async function loadRFPs() {
  try {
    let rfpCountBN = await contract.rfpCount();
    const rfpCount = rfpCountBN.toNumber();
    const container = document.getElementById("rfpList");
    container.innerHTML = ""; // Clear previous list
    for (let i = 0; i < rfpCount; i++) {
      let rfp = await contract.rfps(i);
      // rfp: [creator, title, description, submissionDeadline, revealDeadline, encryptionKey, bidCount]
      const bidCount = rfp.bidCount.toNumber();
      const rfpDiv = document.createElement("div");
      rfpDiv.style.border = "1px solid #aaa";
      rfpDiv.style.padding = "10px";
      rfpDiv.style.marginBottom = "10px";

      let html = `<strong>RFP ID:</strong> ${i}<br>
                  <strong>Title:</strong> ${rfp.title}<br>
                  <strong>Description:</strong> ${rfp.description}<br>
                  <strong>Submission Deadline:</strong> ${formatTimestamp(rfp.submissionDeadline.toNumber())}<br>
                  <strong>Reveal Deadline:</strong> ${formatTimestamp(rfp.revealDeadline.toNumber())}<br>
                  <strong>Number of Bids:</strong> ${bidCount}<br>`;
      rfpDiv.innerHTML = html;

      // Create sub-list for bids
      const bidList = document.createElement("div");
      bidList.style.marginLeft = "20px";
      for (let j = 0; j < bidCount; j++) {
        const bid = await contract.bids(i, j);
        // bid: [bidder, encryptedBid, revealed, plaintextBid]
        const currentTime = Math.floor(Date.now() / 1000);
        let bidContent = "";
        if (currentTime >= rfp.revealDeadline.toNumber() && bid.revealed) {
          bidContent = bid.plaintextBid;
        } else {
          bidContent = bid.encryptedBid;
        }
        const bidDiv = document.createElement("div");
        bidDiv.style.border = "1px dashed #888";
        bidDiv.style.padding = "5px";
        bidDiv.style.marginBottom = "5px";
        bidDiv.innerHTML = `<strong>Bid ID:</strong> ${j}<br>
                            <strong>Bidder:</strong> ${bid.bidder}<br>
                            <strong>${(currentTime >= rfp.revealDeadline.toNumber() && bid.revealed) ? "Plaintext Bid" : "Encrypted Bid"}:</strong> ${bidContent}`;
        bidList.appendChild(bidDiv);
      }
      rfpDiv.appendChild(bidList);
      container.appendChild(rfpDiv);
    }
  } catch (err) {
    console.error("loadRFPs error:", err);
    setStatus("Error loading RFPs: " + err.message);
  }
}

// ======================
// Shutter Integration Functions (Reused from your Shutter Predict code)
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
// Event Listeners
// ======================
document.addEventListener("DOMContentLoaded", async () => {
  // Load configuration and ABI first
  const config = await fetch("public_config.json").then(res => res.json());
  CONTRACT_ADDRESS = config.contract_address;
  SHUTTER_API_BASE = config.shutter_api_base;
  REGISTRY_ADDRESS = config.registry_address;
  
  CONTRACT_ABI = await fetch("contract_abi.json").then(res => res.json());

  // Hook up button event listeners for our functions
  document.getElementById("createRFP-btn").addEventListener("click", createRFP);
  document.getElementById("encryptBid-btn").addEventListener("click", encryptBidForRFP);
  document.getElementById("submitBid-btn").addEventListener("click", submitBid);
  document.getElementById("revealBid-btn").addEventListener("click", revealBid);
  document.getElementById("refreshRFPs-btn").addEventListener("click", loadRFPs);
});
window.connectWallet = connectWallet;
