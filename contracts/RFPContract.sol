// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RFPContract
 * @dev A contract for managing Request for Proposals (RFPs) with sealed bids.
 * Allows organizations to create RFPs, bidders to submit encrypted bids,
 * and the revelation of bids after deadlines.
 */
contract RFPContract is Ownable {
    // Pass msg.sender as the initial owner when deploying.
    constructor() Ownable(msg.sender) {}

    /**
     * @dev Represents a Request for Proposal.
     * @param creator The address that created the RFP.
     * @param title The title of the RFP.
     * @param description A detailed description of the RFP.
     * @param submissionDeadline Timestamp after which bids cannot be submitted.
     * @param revealDeadline Timestamp after which bids can be revealed.
     * @param encryptionKey Public key or information needed for bidders to encrypt bids.
     * @param bidCount The total number of bids submitted for this RFP.
     */
    struct RFP {
        address creator;
        string title;
        string description;
        uint256 submissionDeadline;
        uint256 revealDeadline;
        string encryptionKey; // Consider storing securely or off-chain
        uint256 bidCount;
    }

    /**
     * @dev Represents a bid submitted for an RFP.
     * @param bidder The address of the entity submitting the bid.
     * @param encryptedBid The bid content, encrypted.
     * @param revealed Flag indicating if the bid has been revealed.
     * @param plaintextBid The decrypted bid content, available after revelation.
     */
    struct Bid {
        address bidder;
        bytes encryptedBid;
        bool revealed;
        string plaintextBid;
    }

    /**
     * @dev Represents an organization that can create RFPs.
     * @param name The name of the organization.
     * @param rfpIds An array of IDs for RFPs created by this organization.
     */
    struct Organization {
        string name;
        uint256[] rfpIds; // Dynamic array to store RFP IDs
    }

    // --- State Variables ---

    uint256 public rfpCount; // Counter for total RFPs created
    mapping(uint256 => RFP) public rfps; // Mapping from RFP ID to RFP struct
    mapping(uint256 => mapping(uint256 => Bid)) public bids; // Mapping from RFP ID to Bid ID to Bid struct

    uint256 public orgCount; // Counter for total organizations created
    mapping(uint256 => Organization) public orgs; // Mapping from Organization ID to Organization struct

    // --- Events ---

    event RFPCreated(
        uint256 indexed rfpId,
        address indexed creator,
        string title,
        string encryptionKey // Emitting key for potential off-chain use, consider privacy
    );

    event BidSubmitted(
        uint256 indexed rfpId,
        uint256 indexed bidId,
        address indexed bidder,
        bytes encryptedBid // Emitting encrypted bid hash might be better for privacy
    );

    event BidRevealed(
        uint256 indexed rfpId,
        uint256 indexed bidId,
        address indexed bidder,
        string plaintextBid // Emitting plaintext bid on-chain has privacy implications
    );

    event OrganizationCreated(
        uint256 indexed orgId,
        string name
    );

    // --- Functions ---

    /**
     * @dev Adds a new organization.
     * @param name The name of the organization.
     * @return orgId The ID of the newly created organization.
     */
    function addOrganization(string calldata name) external returns (uint256) {
        uint256 orgId = orgCount;
        // CORRECTED LINE: Initialize rfpIds as an empty dynamic array in memory
        Organization memory newOrg = Organization(name, new uint256[](0));
        orgs[orgId] = newOrg; // Store the new organization in storage
        orgCount++;
        emit OrganizationCreated(orgId, name);
        return orgId;
    }

    /**
     * @dev Retrieves details of an organization.
     * @param orgId The ID of the organization.
     * @return name_ The name of the organization.
     * @return rfpIds_ The array of RFP IDs associated with the organization.
     */
    function getOrganization(uint256 orgId)
        external
        view
        returns (string memory name_, uint256[] memory rfpIds_)
    {
        require(orgId < orgCount, "Organization does not exist");
        Organization storage org = orgs[orgId];
        return (org.name, org.rfpIds);
    }

    /**
     * @dev Creates a new RFP associated with an organization.
     * @param title The title of the RFP.
     * @param description The description of the RFP.
     * @param submissionDeadline The deadline for submitting bids.
     * @param revealDeadline The deadline after which bids can be revealed.
     * @param encryptionKey The encryption key information for the RFP.
     * @param orgId The ID of the organization creating the RFP.
     * @return id The ID of the newly created RFP.
     */
    function createRFP(
        string calldata title,
        string calldata description,
        uint256 submissionDeadline,
        uint256 revealDeadline,
        string calldata encryptionKey,
        uint256 orgId
    ) external returns (uint256) {
        require(block.timestamp < submissionDeadline, "Submission deadline must be in the future");
        require(submissionDeadline < revealDeadline, "Submission deadline must be before reveal deadline");
        require(orgId < orgCount, "Invalid organization ID");

        uint256 id = rfpCount;
        rfps[id] = RFP({
            creator: msg.sender,
            title: title,
            description: description,
            submissionDeadline: submissionDeadline,
            revealDeadline: revealDeadline,
            encryptionKey: encryptionKey,
            bidCount: 0
        });

        // Add the new RFP ID to the organization's list
        // Note: This requires fetching the Organization struct from storage, modifying it,
        // which can be gas-intensive if the array grows large.
        orgs[orgId].rfpIds.push(id);

        rfpCount++;
        emit RFPCreated(id, msg.sender, title, encryptionKey);
        return id;
    }

    /**
     * @dev Submits an encrypted bid to a specific RFP.
     * @param rfpId The ID of the RFP to bid on.
     * @param encryptedBid The encrypted bid data.
     */
    function submitBid(uint256 rfpId, bytes calldata encryptedBid) external {
        // Check if RFP exists implicitly by accessing it. Add explicit check if needed.
        require(rfpId < rfpCount, "RFP does not exist");
        RFP storage rfp = rfps[rfpId];
        require(block.timestamp <= rfp.submissionDeadline, "Submission period is over");
        require(encryptedBid.length > 0, "Encrypted bid cannot be empty");

        uint256 bidId = rfp.bidCount;
        bids[rfpId][bidId] = Bid({
            bidder: msg.sender,
            encryptedBid: encryptedBid,
            revealed: false,
            plaintextBid: "" // Initialize plaintext as empty
        });

        rfps[rfpId].bidCount++; // Increment bid count for the specific RFP
        emit BidSubmitted(rfpId, bidId, msg.sender, encryptedBid);
    }

    /**
     * @dev Reveals all bids for a specific RFP. Can only be called after the reveal deadline.
     * This function assumes the caller (likely the RFP creator or an admin)
     * has decrypted the bids off-chain and provides the plaintexts.
     * @param rfpId The ID of the RFP whose bids are to be revealed.
     * @param plaintextBids An array of plaintext bid strings corresponding to each bid ID.
     */
    function revealAllBids(uint256 rfpId, string[] calldata plaintextBids) external {
        require(rfpId < rfpCount, "RFP does not exist");
        RFP storage rfp = rfps[rfpId];
        // Only allow reveal after the deadline
        require(block.timestamp >= rfp.revealDeadline, "Reveal period has not started yet");
        // Ensure the number of provided plaintexts matches the number of bids submitted
        uint256 count = rfp.bidCount;
        require(plaintextBids.length == count, "Incorrect number of plaintext bids provided");

        // Iterate through all bids for the RFP and update them
        for (uint256 i = 0; i < count; i++) {
            Bid storage bid = bids[rfpId][i];
            // Only reveal if not already revealed
            if (!bid.revealed) {
                // TODO: Add verification logic here if possible.
                // E.g., hash(plaintextBids[i]) == expectedHash derived from encryptedBid + key.
                // This requires a cryptographic scheme where verification is possible on-chain.
                // Without verification, the caller can submit arbitrary plaintext.

                bid.plaintextBid = plaintextBids[i];
                bid.revealed = true;
                emit BidRevealed(rfpId, i, bid.bidder, plaintextBids[i]);
            }
        }
    }

    /**
     * @dev Retrieves the encryption key for a specific RFP.
     * Note: Access control might be needed depending on who should see the key.
     * Currently, anyone can call this. Consider restricting access (e.g., only bidders).
     * @param rfpId The ID of the RFP.
     * @return The encryption key string stored for the RFP.
     */
    function getRFPEncryptionKey(uint256 rfpId) external view returns (string memory) {
        require(rfpId < rfpCount, "RFP does not exist");
        return rfps[rfpId].encryptionKey;
    }

    /**
     * @dev Retrieves a specific bid's details.
     * @param rfpId The ID of the RFP.
     * @param bidId The ID of the bid.
     * @return bidder The address of the bidder.
     * @return encryptedBid The encrypted bid data.
     * @return revealed Whether the bid has been revealed.
     * @return plaintextBid The plaintext bid (if revealed, otherwise empty).
     */
    function getBid(uint256 rfpId, uint256 bidId)
        external
        view
        returns (
            address bidder,
            bytes memory encryptedBid,
            bool revealed,
            string memory plaintextBid
        )
    {
        require(rfpId < rfpCount, "RFP does not exist");
        require(bidId < rfps[rfpId].bidCount, "Bid does not exist");
        Bid storage bid = bids[rfpId][bidId];
        return (bid.bidder, bid.encryptedBid, bid.revealed, bid.plaintextBid);
    }
}
