import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";

// Configuration and Contract Instances
let CONTRACT_ADDRESS, CONTRACT_ABI, GNOSIS_RPC_URL;
// SHUTTER_API_BASE, REGISTRY_ADDRESS; // Keep if needed elsewhere based on full config usage

let readOnlyProvider = null;
let readOnlyContract = null; // For reading data via RPC

let web3Provider = null;    // Provider from MetaMask (if connected)
let signer = null;          // Signer from MetaMask (if connected)
let writeContract = null;   // Contract instance for sending transactions (if connected)

// --- DOM Elements ---
let statusElement = null;
let createOrgButton = null;
let orgNameInput = null;
let orgListContainer = null;


// --- Utility Functions ---

function setStatus(msg) {
    console.log("STATUS:", msg);
    if (statusElement) {
        statusElement.textContent = "Status: " + msg;
    }
}

// Controls the enabled/disabled state of elements needed for adding an org
function disableInteraction(disabled) {
    if (createOrgButton) createOrgButton.disabled = disabled;
    if (orgNameInput) orgNameInput.disabled = disabled;
    // Update placeholder based on state
    if (orgNameInput) {
         orgNameInput.placeholder = disabled ? "Connect wallet to add" : "Enter organisation name";
    }
}

// --- Core Logic ---

// Initialize read-only connection using RPC URL from config
async function initializeReadOnlyProvider(rpcUrl, contractAddress, contractAbi) {
    try {
        setStatus("Initializing read connection via RPC...");
        readOnlyProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
        // Verify connection
        const network = await readOnlyProvider.getNetwork();
        if (network.chainId !== 100) { // Gnosis Chain ID
           throw new Error(`RPC connected to wrong network (Chain ID: ${network.chainId}). Expected Gnosis (100).`);
        }
        console.log("Read-only provider connected to Gnosis Chain via RPC.");
        readOnlyContract = new ethers.Contract(contractAddress, contractAbi, readOnlyProvider);
        setStatus("Read connection successful. Ready to load organisations.");
        return true; // Indicate success
    } catch (error) {
        console.error("Read-only initialization failed:", error);
        setStatus(`Error initializing read connection: ${error.message}`);
        return false; // Indicate failure
    }
}

// Function to load and display organizations using the read-only contract
async function loadOrganizations() {
    if (!readOnlyContract) {
        setStatus("Read connection not available. Cannot load organisations.");
        if(orgListContainer) orgListContainer.innerHTML = "<p>Could not establish read connection.</p>";
        return;
    }
    setStatus("Loading organisations via RPC...");
     if(orgListContainer) orgListContainer.innerHTML = "<p>Loading organisations...</p>"; // Clear previous list/message

    try {
        const orgCountBN = await readOnlyContract.orgCount();
        const orgCount = orgCountBN.toNumber();

         orgListContainer.innerHTML = ""; // Clear loading message

        setStatus(`Loading ${orgCount} organisation(s)...`);

        if (orgCount === 0) {
             orgListContainer.innerHTML = "<p>No organisations found.</p>";
        } else {
            for (let i = 0; i < orgCount; i++) {
                // Fetch the organization data (which is just the name string)
                 const orgData = await readOnlyContract.orgs(i);
                 const orgName = orgData; // Use data directly as it's the string name

                const orgDiv = document.createElement("div");
                orgDiv.className = "org-item";
                orgDiv.textContent = String(orgName || "Unnamed org");

                // Navigate to details page on click
                orgDiv.onclick = () => {
                    window.location.href = `rfp.html?orgId=${i}`;
                };
                orgListContainer.appendChild(orgDiv);
            }
        }
        setStatus("Organisations loaded.");

    } catch (err) {
        console.error("loadOrganizations error:", err);
        setStatus("Error loading organisations: " + err.message);
        orgListContainer.innerHTML = "<p>Could not load organisations.</p>"; // Show error in list area
    }
}

// Function to ATTEMPT automatic connection to MetaMask wallet on page load,
// PROMPTING the user if necessary.
async function connectWalletOnLoad() {
  if (typeof window.ethereum === 'undefined') {
      setStatus("MetaMask not detected. Read-only mode.");
      console.log("MetaMask not found. Install MetaMask to interact.");
      disableInteraction(true); // Keep interaction disabled
      return; // Exit gracefully
  }

  setStatus("Attempting wallet connection...");
  try {
      let accounts;
      // Request account access. This WILL trigger the MetaMask popup
      // if the site is not already connected/authorized.
      try {
           setStatus("Please connect your wallet via the MetaMask prompt...");
           accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (requestError) {
           // Handle cases where the user rejects the connection request
           console.error("Wallet connection request rejected:", requestError);
           setStatus("Wallet connection rejected by user. Read-only mode. Refresh page to retry wallet connection.");
           disableInteraction(true);
           return; // Stop the connection attempt
      }


      // If accounts are returned (user approved connection)
      if (accounts && accounts.length > 0) {
          console.log("Wallet accounts accessed:", accounts);
          web3Provider = new ethers.providers.Web3Provider(window.ethereum);

          // Check network
          const network = await web3Provider.getNetwork();
          console.log("Connected network:", network);

          if (network.chainId !== 100) { // Gnosis Chain ID
              setStatus("Wallet connected. Please switch network to Gnosis Chain.");
               // Attempt to switch/add Gnosis Chain
              try {
                   const gnosisChainParams = {
                       chainId: '0x64', // 100
                       chainName: 'Gnosis Chain',
                       nativeCurrency: { name: 'XDAI', symbol: 'XDAI', decimals: 18 },
                       rpcUrls: [GNOSIS_RPC_URL], // Use RPC from config
                       blockExplorerUrls: ['https://gnosisscan.io']
                   };
                   await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [gnosisChainParams] });
                   // Re-initialize provider and check network again
                   web3Provider = new ethers.providers.Web3Provider(window.ethereum);
                   const updatedNetwork = await web3Provider.getNetwork();
                    if (updatedNetwork.chainId !== 100) {
                        throw new Error("Failed to switch to Gnosis Chain after request.");
                    }
                    console.log("Switched to Gnosis Chain successfully.");
                    // Re-fetch signer after network switch potentially needed
                    signer = web3Provider.getSigner();

              } catch (switchError) {
                   console.error("Failed to switch/add Gnosis Chain:", switchError);
                   setStatus("Failed to switch to Gnosis Chain. Please do it manually in MetaMask.");
                   disableInteraction(true); // Disable interaction if on wrong network
                   return; // Stop connection process if network is wrong
              }
          }

          // Get signer if not already set during network switch attempt
           if (!signer) {
              signer = web3Provider.getSigner();
           }
          const address = await signer.getAddress();

          // Create writable contract instance
          writeContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

          setStatus(`Wallet connected: ${address.substring(0, 6)}... on Gnosis Chain`);
          disableInteraction(false); // Enable interaction for adding org

          // Listen for account changes
          window.ethereum.on('accountsChanged', (newAccounts) => {
              console.log('Accounts changed:', newAccounts);
              // Reload or re-connect to handle the new account state
              window.location.reload(); // Simple way to handle account change
          });

          // Listen for network changes
          window.ethereum.on('chainChanged', (chainId) => {
               console.log('Network changed to:', chainId);
               // Reload or re-validate connection
               window.location.reload(); // Simple way to handle network change
          });


      } else {
           // This case should ideally not be reached if eth_requestAccounts succeeds
           setStatus("No accounts found after connection attempt.");
           disableInteraction(true);
      }

  } catch (error) {
      // Catch any other unexpected errors during the connection process
      console.error("Wallet connection process failed:", error);
      setStatus(`Wallet connection failed: ${error.message || "Unknown error"}`);
      disableInteraction(true); // Keep interaction disabled on error
  }
}

// Function to create an organization using the writable contract
async function createOrganization() {
    // Ensure wallet is connected and writable contract exists
    if (!signer || !writeContract) {
        setStatus("Wallet not connected or not on Gnosis Chain. Please connect/switch in MetaMask.");
        // Optionally trigger a connection attempt again here or alert user
        // await connectWalletOnLoad(); // Re-attempt connection? Might be intrusive.
         alert("Please ensure your wallet is connected to the Gnosis Chain.");
        return;
    }

    const orgName = orgNameInput.value.trim();
    if (!orgName) {
        setStatus("Please enter an organisation name.");
        return;
    }

    setStatus("Sending transaction to create organisation...");
    disableInteraction(true); // Disable inputs during transaction

    try {
        const tx = await writeContract.addOrganization(orgName);
        setStatus(`Transaction sent: ${tx.hash}. Waiting for confirmation...`);

        await tx.wait(1); // Wait for 1 confirmation

        setStatus("Organisation created successfully! Refreshing list...");
        orgNameInput.value = ""; // Clear input field
        await loadOrganizations(); // Reload the list using read-only connection

    } catch (err) {
        console.error("createOrganization error:", err);
        const reason = err.reason || err.message || "Unknown error";
        setStatus(`Error creating organisation: ${reason}`);
        alert(`Error creating organisation: ${reason}`);
    } finally {
         // Re-enable interaction only if wallet is still considered connected properly
         if(signer && writeContract) {
            // Verify network again before re-enabling? Optional paranoia.
            const currentNetwork = await web3Provider.getNetwork();
            if (currentNetwork.chainId === 100) {
                 disableInteraction(false);
            } else {
                 setStatus("Wallet connected, but please switch back to Gnosis Chain.");
                 disableInteraction(true);
            }
         } else {
             disableInteraction(true); // Ensure disabled if connection lost/failed
         }
    }
}


// --- Initialization on DOM Load ---

document.addEventListener("DOMContentLoaded", async () => {
    // --- Get DOM Elements ---
    statusElement = document.getElementById("status");
    createOrgButton = document.getElementById("createOrg-btn");
    orgNameInput = document.getElementById("orgName");
    orgListContainer = document.getElementById("orgList");

    if (!statusElement || !createOrgButton || !orgNameInput || !orgListContainer) {
        console.error("One or more required DOM elements not found!");
        setStatus("Error: Page elements missing.");
        return;
    }

    // --- Initial UI State ---
    disableInteraction(true); // Disable create org controls initially
     if(orgListContainer) orgListContainer.innerHTML = "<p>Initializing...</p>";

    // --- Load Config ---
    setStatus("Loading configuration...");
    let config;
    try {
        config = await fetch("public_config.json?v=" + Date.now()).then(res => {
             if (!res.ok) throw new Error(`Failed to fetch public_config.json: ${res.statusText}`);
             return res.json();
        });
        CONTRACT_ADDRESS = config.contract_address;
        GNOSIS_RPC_URL = config.rpc_url;
        // SHUTTER_API_BASE = config.shutter_api_base; // Assign if needed
        // REGISTRY_ADDRESS = config.registry_address; // Assign if needed

        CONTRACT_ABI = await fetch("contract_abi.json?v=" + Date.now()).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch contract_abi.json: ${res.statusText}`);
            return res.json();
        });

         if (!CONTRACT_ADDRESS || !CONTRACT_ABI || !GNOSIS_RPC_URL) {
             throw new Error("RPC URL, Contract address or ABI missing in configuration.");
         }

    } catch (error) {
        console.error("Failed to load configuration:", error);
        setStatus(`Error loading configuration: ${error.message}`);
        disableInteraction(true);
        if(orgListContainer) orgListContainer.innerHTML = "<p>Failed to load configuration.</p>";
        return; // Stop initialization
    }

     // --- Add Event Listener for Create Button ---
     // Needs to be added after element is found but before interaction is enabled
    createOrgButton.addEventListener("click", createOrganization);


    // --- Initialize Read Connection & Load Initial Data ---
    const readOnlyReady = await initializeReadOnlyProvider(GNOSIS_RPC_URL, CONTRACT_ADDRESS, CONTRACT_ABI);
    if (readOnlyReady) {
       await loadOrganizations(); // Load the org list using RPC
    } else {
       // Handle case where even read-only connection fails
       if(orgListContainer) orgListContainer.innerHTML = "<p>Could not connect to RPC to load organisations.</p>";
       disableInteraction(true); // Keep disabled if RPC fails
       // Maybe stop here or proceed to wallet connection attempt anyway?
       // Let's proceed to wallet connection attempt even if RPC failed initially.
    }


    // --- Attempt Automatic Wallet Connection ---
    // This runs after setting up read-only and loading initial list
    await connectWalletOnLoad();

});