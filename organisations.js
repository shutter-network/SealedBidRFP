import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";

let provider = null;
let signer = null;
let contract = null;
let CONTRACT_ADDRESS, CONTRACT_ABI, SHUTTER_API_BASE, REGISTRY_ADDRESS;

function setStatus(msg) {
  console.log("STATUS:", msg);
  document.getElementById("status").textContent = "Status: " + msg;
}

export async function connectWallet() {
  if (!window.ethereum) {
    alert("MetaMask not found!");
    return;
  }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  provider = new ethers.providers.Web3Provider(window.ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== 100) {
    const gnosisChainParams = {
      chainId: '0x64',
      chainName: 'Gnosis Chain',
      nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
      rpcUrls: ['https://rpc.gnosischain.com'],
      blockExplorerUrls: ['https://gnosisscan.io']
    };
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [gnosisChainParams] });
    provider = new ethers.providers.Web3Provider(window.ethereum);
  }
  signer = provider.getSigner();
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  setStatus("Wallet connected to Gnosis Chain!");
}

async function loadOrganizations() {
    try {
        const orgCountBN = await contract.orgCount();
        const orgCount = orgCountBN.toNumber();
        const orgListContainer = document.getElementById("orgList");
        orgListContainer.innerHTML = "";

        setStatus(`Loading ${orgCount} organisation(s)...`);

        for (let i = 0; i < orgCount; i++) {
            // Fetch the organization data (which is just the name string)
            const orgData = await contract.orgs(i);

            console.log(`Index ${i}: Raw orgData received from contract.orgs(${i}):`, orgData);

            // *** FIX HERE: Use orgData directly, not orgData[0] ***
            const orgName = orgData;

            console.log(`Index ${i}: Correctly assigned orgName:`, orgName, `(Type: ${typeof orgName})`);

            const orgDiv = document.createElement("div");
            orgDiv.className = "org-item";
            // Use the correct orgName variable
            orgDiv.textContent = String(orgName || "Unnamed org");

            orgDiv.onclick = () => {
                window.location.href = `rfp.html?orgId=${i}`;
            };
            orgListContainer.appendChild(orgDiv);
        }

        setStatus("Organisations loaded.");

    } catch (err) {
        console.error("loadOrganizations error:", err);
        setStatus("Error loading organisations: " + err.message);
    }
}
  

async function createOrganization() {
  const orgName = document.getElementById("orgName").value.trim();
  if (!orgName) {
    setStatus("Please enter an organisation name.");
    return;
  }
  setStatus("Creating organisation...");
  try {
    const tx = await contract.addOrganization(orgName);
    await tx.wait();
    setStatus("Organisation created successfully!");
    loadOrganizations();
  } catch (err) {
    console.error("createOrganization error:", err);
    setStatus("Error creating organisation: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const config = await fetch("public_config.json?v=" + new Date().getTime()).then(res => res.json());
  CONTRACT_ADDRESS = config.contract_address;
  SHUTTER_API_BASE = config.shutter_api_base;
  REGISTRY_ADDRESS = config.registry_address;
  CONTRACT_ABI = await fetch("contract_abi.json?v=" + new Date().getTime()).then(res => res.json());
  
  await connectWallet();
  loadOrganizations();
  
  document.getElementById("createOrg-btn").addEventListener("click", createOrganization);
});
