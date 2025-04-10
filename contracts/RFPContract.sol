// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RFPContract is Ownable {
    // Pass msg.sender as the initial owner when deploying the contract.
    constructor() Ownable(msg.sender) {}

    struct RFP {
        address creator;
        string title;
        string description;
        uint256 submissionDeadline;
        uint256 revealDeadline;
        string encryptionKey; // Encryption parameters as a JSON string
        uint256 bidCount;
    }
    
    struct Bid {
        address bidder;
        bytes encryptedBid;
        bool revealed;
        string plaintextBid;
    }
    
    uint256 public rfpCount;
    mapping(uint256 => RFP) public rfps;
    mapping(uint256 => mapping(uint256 => Bid)) public bids;
    
    event RFPCreated(
        uint256 indexed rfpId,
        address indexed creator,
        string title,
        string encryptionKey
    );
    
    event BidSubmitted(
        uint256 indexed rfpId,
        uint256 indexed bidId,
        address indexed bidder,
        bytes encryptedBid
    );
    
    event BidRevealed(
        uint256 indexed rfpId,
        uint256 indexed bidId,
        address indexed bidder,
        string plaintextBid
    );
    
    // Create a new RFP
    function createRFP(
        string calldata title,
        string calldata description,
        uint256 submissionDeadline,
        uint256 revealDeadline,
        string calldata encryptionKey
    ) external returns (uint256) {
        require(submissionDeadline < revealDeadline, "Submission deadline must be before reveal deadline");
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
        rfpCount++;
        emit RFPCreated(id, msg.sender, title, encryptionKey);
        return id;
    }
    
    // Submit a sealed bid to an RFP
    function submitBid(uint256 rfpId, bytes calldata encryptedBid) external {
        RFP storage rfp = rfps[rfpId];
        require(block.timestamp <= rfp.submissionDeadline, "Submission period is over");
        uint256 bidId = rfp.bidCount;
        bids[rfpId][bidId] = Bid({
            bidder: msg.sender,
            encryptedBid: encryptedBid,
            revealed: false,
            plaintextBid: ""
        });
        rfps[rfpId].bidCount++;
        emit BidSubmitted(rfpId, bidId, msg.sender, encryptedBid);
    }
    
    // Reveal all bids for a particular RFP in a single transaction.
    function revealAllBids(uint256 rfpId, string[] calldata plaintextBids) external {
        RFP storage rfp = rfps[rfpId];
        require(block.timestamp >= rfp.revealDeadline, "Reveal period not started");
        uint256 count = rfp.bidCount;
        require(plaintextBids.length == count, "Incorrect number of bids provided");
        for (uint256 i = 0; i < count; i++) {
            Bid storage bid = bids[rfpId][i];
            if (!bid.revealed) {
                bid.plaintextBid = plaintextBids[i];
                bid.revealed = true;
                emit BidRevealed(rfpId, i, bid.bidder, plaintextBids[i]);
            }
        }
    }
    
    // Getter for RFP encryption key.
    function getRFPEncryptionKey(uint256 rfpId) external view returns (string memory) {
        return rfps[rfpId].encryptionKey;
    }
}
